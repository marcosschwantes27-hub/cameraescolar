import hashlib
import math
from collections import Counter, defaultdict
from typing import Annotated
from uuid import UUID

import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.audit import append_audit_log
from app.config import get_settings
from app.dependencies import DbSession, require_roles
from app.enums import EnrollmentPose, FaceEnrollmentStatus, UserRole
from app.face_matching import (
    find_duplicate_profile,
    load_face_profiles,
    rank_recognition_candidates,
)
from app.face_service import (
    MODEL_VERSION,
    FaceProcessingError,
    FaceService,
    FrameAnalysis,
    get_face_service,
)
from app.models import Classroom, FaceEmbedding, School, Student, User
from app.normalization import student_search_text
from app.routers.students import get_student_or_404
from app.schemas import FaceEnrollmentRead, FaceRecognitionRead
from app.serializers import student_to_read

router = APIRouter(prefix="/api/v1", tags=["faces"])
FaceOperator = Annotated[
    User,
    Depends(require_roles(UserRole.ADMIN, UserRole.COORDINATOR)),
]
StudentFaceWriter = Annotated[User, Depends(require_roles(UserRole.ADMIN))]
FaceEngine = Annotated[FaceService, Depends(get_face_service)]
MAX_FRAME_BYTES = 5 * 1024 * 1024
MIN_RECOGNITION_FRAMES = 3
MAX_RECOGNITION_FRAMES = 8
GUIDED_FRAMES_PER_POSE = 3
GUIDED_FRAMES = len(EnrollmentPose) * GUIDED_FRAMES_PER_POSE
STORED_FRAMES_PER_POSE = 2
ALLOWED_MEDIA_TYPES = {"image/jpeg", "image/png", "image/webp"}


async def read_frames(
    files: list[UploadFile],
    *,
    minimum: int,
    maximum: int,
) -> list[bytes]:
    if not minimum <= len(files) <= maximum:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Envie entre {minimum} e {maximum} frames",
        )
    frames: list[bytes] = []
    frame_hashes: set[bytes] = set()
    for file in files:
        if file.content_type not in ALLOWED_MEDIA_TYPES:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Use imagens JPEG, PNG ou WebP",
            )
        content = await file.read(MAX_FRAME_BYTES + 1)
        if len(content) > MAX_FRAME_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail="Cada frame pode ter no máximo 5 MB",
            )
        frame_hash = hashlib.sha256(content).digest()
        if frame_hash in frame_hashes:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="As imagens precisam ser capturas diferentes da câmera",
            )
        frame_hashes.add(frame_hash)
        frames.append(content)
    return frames


def analyze_or_422(engine: FaceService, frames: list[bytes]) -> list[FrameAnalysis]:
    analyses, rejected = engine.analyze_frames(frames)
    accepted = engine.remove_outliers(analyses)
    if len(accepted) < MIN_RECOGNITION_FRAMES:
        reason = rejected[0] if rejected else "Os frames não são consistentes entre si"
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(f"Não foi possível obter {MIN_RECOGNITION_FRAMES} imagens válidas. {reason}"),
        )
    return accepted


def parse_guided_poses(
    raw_poses: list[str] | None, frame_count: int
) -> list[EnrollmentPose] | None:
    if raw_poses is None:
        return None
    if len(raw_poses) != frame_count:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Cada imagem do cadastro guiado precisa informar sua posição",
        )
    try:
        poses = [EnrollmentPose(pose) for pose in raw_poses]
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="O cadastro contém uma posição facial inválida",
        ) from error
    counts = Counter(poses)
    if any(counts[pose] != GUIDED_FRAMES_PER_POSE for pose in EnrollmentPose):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Capture três imagens em cada uma das cinco posições",
        )
    return poses


def analyze_guided_or_422(
    engine: FaceService,
    frames: list[bytes],
    poses: list[EnrollmentPose],
) -> list[tuple[EnrollmentPose, FrameAnalysis]]:
    accepted: list[tuple[EnrollmentPose, FrameAnalysis]] = []
    rejected: list[str] = []
    for index, (frame, pose) in enumerate(zip(frames, poses, strict=True), start=1):
        try:
            accepted.append((pose, engine.analyze(frame)))
        except FaceProcessingError as error:
            rejected.append(f"Imagem {index}: {error}")

    retained = {id(item) for item in engine.remove_outliers([item for _, item in accepted])}
    accepted = [(pose, item) for pose, item in accepted if id(item) in retained]
    grouped: dict[EnrollmentPose, list[FrameAnalysis]] = defaultdict(list)
    for pose, analysis in accepted:
        grouped[pose].append(analysis)

    insufficient = [
        pose for pose in EnrollmentPose if len(grouped[pose]) < STORED_FRAMES_PER_POSE
    ]
    if insufficient:
        reason = rejected[0] if rejected else "Algumas posições não produziram imagens consistentes"
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Repita o cadastro guiado. {reason}",
        )

    front_yaw = float(np.median([item.yaw_offset for item in grouped[EnrollmentPose.FRONT]]))
    front_pitch = float(np.median([item.pitch_ratio for item in grouped[EnrollmentPose.FRONT]]))
    left_delta = float(
        np.median([item.yaw_offset for item in grouped[EnrollmentPose.LEFT]]) - front_yaw
    )
    right_delta = float(
        np.median([item.yaw_offset for item in grouped[EnrollmentPose.RIGHT]]) - front_yaw
    )
    if min(abs(left_delta), abs(right_delta)) < 0.035 or left_delta * right_delta >= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Vire mais o rosto para lados opostos nas etapas esquerda e direita",
        )

    up_delta = float(
        np.median([item.pitch_ratio for item in grouped[EnrollmentPose.UP]]) - front_pitch
    )
    down_delta = float(
        np.median([item.pitch_ratio for item in grouped[EnrollmentPose.DOWN]]) - front_pitch
    )
    if min(abs(up_delta), abs(down_delta)) < 0.025 or up_delta * down_delta >= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Incline mais o rosto para cima e para baixo nas etapas indicadas",
        )
    return [
        (pose, analysis)
        for pose in EnrollmentPose
        for analysis in sorted(grouped[pose], key=lambda item: item.quality, reverse=True)[
            :STORED_FRAMES_PER_POSE
        ]
    ]


async def prepare_face_enrollment(
    engine: FaceService,
    files: list[UploadFile],
    raw_poses: list[str] | None,
) -> tuple[
    list[bytes],
    list[tuple[EnrollmentPose | None, FrameAnalysis]],
    bool,
]:
    guided = parse_guided_poses(raw_poses, len(files))
    if guided is None:
        contents = await read_frames(
            files,
            minimum=MIN_RECOGNITION_FRAMES,
            maximum=MAX_RECOGNITION_FRAMES,
        )
        analyses = await run_in_threadpool(analyze_or_422, engine, contents)
        best = sorted(analyses, key=lambda item: item.quality, reverse=True)[:5]
        return contents, [(None, analysis) for analysis in best], False

    contents = await read_frames(files, minimum=GUIDED_FRAMES, maximum=GUIDED_FRAMES)
    analyzed = await run_in_threadpool(analyze_guided_or_422, engine, contents, guided)
    enrolled: list[tuple[EnrollmentPose | None, FrameAnalysis]] = list(analyzed)
    return contents, enrolled, True


def lock_school_face_enrollments(session: Session, school_id: UUID) -> None:
    session.execute(
        select(School.id).where(School.id == school_id).with_for_update()
    ).scalar_one()


def reject_duplicate_face(
    session: Session,
    *,
    school_id: UUID,
    enrolled: list[tuple[EnrollmentPose | None, FrameAnalysis]],
    exclude_student_id: UUID | None = None,
) -> None:
    profiles = load_face_profiles(
        session,
        school_id=school_id,
        expected_dimension=enrolled[0][1].embedding.size,
        exclude_student_id=exclude_student_id,
    )
    settings = get_settings()
    duplicate = find_duplicate_profile(
        profiles,
        enrolled,
        frame_threshold=settings.face_duplicate_frame_threshold,
        median_threshold=settings.face_duplicate_median_threshold,
        required_ratio=settings.face_duplicate_required_ratio,
    )
    if duplicate is None:
        return

    student = duplicate.profile.student
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            "Possível rosto já cadastrado para "
            f"{student.name}, matrícula {student.enrollment_code}, turma "
            f"{student.classroom.name}. Confira o aluno antes de continuar."
        ),
    )


def store_face_templates(
    session: Session,
    *,
    student: Student,
    school_id: UUID,
    enrolled: list[tuple[EnrollmentPose | None, FrameAnalysis]],
) -> None:
    session.execute(
        delete(FaceEmbedding).where(
            FaceEmbedding.student_id == student.id,
            FaceEmbedding.school_id == school_id,
        )
    )
    for pose, analysis in enrolled:
        session.add(
            FaceEmbedding(
                school_id=school_id,
                student_id=student.id,
                embedding=analysis.embedding.tolist(),
                quality_score=analysis.quality,
                model_version=MODEL_VERSION,
                enrollment_pose=pose.value if pose else None,
            )
        )
    student.face_enrollment_status = FaceEnrollmentStatus.ENROLLED.value


@router.post(
    "/student-face-enrollments",
    response_model=FaceEnrollmentRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_student_with_face(
    session: DbSession,
    user: StudentFaceWriter,
    engine: FaceEngine,
    frames: Annotated[list[UploadFile], File(description="Frames capturados pela câmera")],
    name: Annotated[str, Form(min_length=2, max_length=160)],
    enrollment_code: Annotated[
        str,
        Form(alias="enrollmentCode", min_length=1, max_length=60),
    ],
    classroom_id: Annotated[UUID, Form(alias="classroomId")],
    poses: Annotated[list[str] | None, Form(description="Posição de cada frame")] = None,
    preferred_name: Annotated[
        str | None,
        Form(alias="preferredName", max_length=100),
    ] = None,
) -> FaceEnrollmentRead:
    classroom = session.scalar(
        select(Classroom).where(
            Classroom.id == classroom_id,
            Classroom.school_id == user.school_id,
            Classroom.is_active.is_(True),
        )
    )
    if classroom is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Turma não encontrada")

    clean_name = name.strip()
    clean_enrollment_code = enrollment_code.strip()
    clean_preferred_name = preferred_name.strip() if preferred_name else None
    if len(clean_name) < 2 or not clean_enrollment_code:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Informe nome e matrícula válidos",
        )

    contents, enrolled, guided = await prepare_face_enrollment(engine, frames, poses)
    lock_school_face_enrollments(session, user.school_id)
    reject_duplicate_face(
        session,
        school_id=user.school_id,
        enrolled=enrolled,
    )

    student = Student(
        school_id=user.school_id,
        classroom_id=classroom.id,
        name=clean_name,
        preferred_name=clean_preferred_name,
        enrollment_code=clean_enrollment_code,
        search_text=student_search_text(
            name=clean_name,
            preferred_name=clean_preferred_name,
            enrollment_code=clean_enrollment_code,
        ),
    )
    session.add(student)
    try:
        session.flush()
    except IntegrityError as error:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Já existe um aluno com essa matrícula nesta escola",
        ) from error

    store_face_templates(
        session,
        student=student,
        school_id=user.school_id,
        enrolled=enrolled,
    )
    append_audit_log(
        session,
        actor=user,
        action="student.created",
        entity_type="student",
        entity_id=student.id,
        details={"enrollmentCode": student.enrollment_code, "withFace": True},
    )
    append_audit_log(
        session,
        actor=user,
        action="face.enrolled",
        entity_type="student",
        entity_id=student.id,
        details={
            "acceptedFrames": len(enrolled),
            "guided": guided,
            "model": MODEL_VERSION,
        },
    )
    session.commit()
    student.classroom = classroom
    return FaceEnrollmentRead(
        student=student_to_read(student),
        frames_received=len(contents),
        frames_accepted=len(enrolled),
        model_version=MODEL_VERSION,
    )


@router.post(
    "/students/{student_id}/face-enrollment",
    response_model=FaceEnrollmentRead,
)
async def enroll_face(
    student_id: UUID,
    session: DbSession,
    user: FaceOperator,
    engine: FaceEngine,
    frames: Annotated[list[UploadFile], File(description="Frames capturados pela câmera")],
    poses: Annotated[list[str] | None, Form(description="Posição de cada frame")] = None,
) -> FaceEnrollmentRead:
    student = get_student_or_404(session, student_id, user.school_id)
    contents, enrolled, guided = await prepare_face_enrollment(engine, frames, poses)

    lock_school_face_enrollments(session, user.school_id)
    reject_duplicate_face(
        session,
        school_id=user.school_id,
        enrolled=enrolled,
        exclude_student_id=student.id,
    )
    store_face_templates(
        session,
        student=student,
        school_id=user.school_id,
        enrolled=enrolled,
    )
    append_audit_log(
        session,
        actor=user,
        action="face.enrolled",
        entity_type="student",
        entity_id=student.id,
        details={
            "acceptedFrames": len(enrolled),
            "guided": guided,
            "model": MODEL_VERSION,
        },
    )
    session.commit()
    return FaceEnrollmentRead(
        student=student_to_read(student),
        frames_received=len(contents),
        frames_accepted=len(enrolled),
        model_version=MODEL_VERSION,
    )


@router.post("/recognition/identify", response_model=FaceRecognitionRead)
async def identify_face(
    session: DbSession,
    user: FaceOperator,
    engine: FaceEngine,
    frames: Annotated[list[UploadFile], File(description="Frames capturados pela câmera")],
) -> FaceRecognitionRead:
    contents = await read_frames(
        frames,
        minimum=MIN_RECOGNITION_FRAMES,
        maximum=MAX_RECOGNITION_FRAMES,
    )
    raw_analyses, rejected = await run_in_threadpool(engine.analyze_frames, contents)
    analyses = engine.remove_outliers(raw_analyses)
    if len(analyses) < MIN_RECOGNITION_FRAMES:
        reason = rejected[0] if rejected else "Os frames não são consistentes entre si"
        return FaceRecognitionRead(
            matched=False,
            student=None,
            similarity=None,
            frames_analyzed=len(analyses),
            agreeing_frames=0,
            message=f"Rosto não reconhecido. {reason}",
        )
    profiles = load_face_profiles(
        session,
        school_id=user.school_id,
        expected_dimension=analyses[0].embedding.size,
    )
    if not profiles:
        return FaceRecognitionRead(
            matched=False,
            student=None,
            similarity=None,
            frames_analyzed=len(analyses),
            agreeing_frames=0,
            message="Nenhum aluno possui biometria cadastrada",
        )

    settings = get_settings()
    ranked = rank_recognition_candidates(
        profiles,
        analyses,
        frame_threshold=settings.face_match_threshold,
    )
    best = ranked[0]
    best_score = best.median_score
    second_score = ranked[1].median_score if len(ranked) > 1 else 0.0
    required_votes = max(2, math.ceil(len(analyses) * 0.7))
    agreeing = best.agreeing_frames
    matched = (
        best_score >= settings.face_match_threshold
        and agreeing >= required_votes
        and best_score - second_score >= settings.face_match_margin
    )
    if not matched:
        return FaceRecognitionRead(
            matched=False,
            student=None,
            similarity=round(best_score * 100, 1),
            frames_analyzed=len(analyses),
            agreeing_frames=agreeing,
            message="Rosto não reconhecido com segurança; confirme manualmente",
        )

    student = best.profile.student
    append_audit_log(
        session,
        actor=user,
        action="face.identified",
        entity_type="student",
        entity_id=student.id,
        details={
            "similarity": round(best_score, 4),
            "agreeingFrames": agreeing,
            "framesAnalyzed": len(analyses),
            "model": MODEL_VERSION,
        },
    )
    session.commit()
    return FaceRecognitionRead(
        matched=True,
        student=student_to_read(student),
        similarity=round(best_score * 100, 1),
        frames_analyzed=len(analyses),
        agreeing_frames=agreeing,
        message="Aluno identificado; confirme os dados antes de registrar",
    )

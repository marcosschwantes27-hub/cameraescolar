from __future__ import annotations

import math
from collections import Counter, defaultdict
from dataclasses import dataclass
from uuid import UUID

import numpy as np
from numpy.typing import NDArray
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.enums import EnrollmentPose
from app.face_service import MODEL_VERSION, FrameAnalysis
from app.models import FaceEmbedding, Student


@dataclass(frozen=True)
class FaceTemplate:
    pose: EnrollmentPose | None
    embedding: NDArray[np.float32]


@dataclass(frozen=True)
class FaceProfile:
    student: Student
    templates: tuple[FaceTemplate, ...]


@dataclass(frozen=True)
class CandidateScore:
    profile: FaceProfile
    median_score: float
    agreeing_frames: int


def _normalize_stored_embedding(
    embedding: list[float],
    *,
    expected_dimension: int,
) -> NDArray[np.float32] | None:
    vector = np.asarray(embedding, dtype=np.float32).reshape(-1)
    if vector.size != expected_dimension or not np.all(np.isfinite(vector)):
        return None
    norm = float(np.linalg.norm(vector))
    if not np.isfinite(norm) or norm <= 0:
        return None
    return np.asarray(vector / norm, dtype=np.float32)


def load_face_profiles(
    session: Session,
    *,
    school_id: UUID,
    expected_dimension: int,
    exclude_student_id: UUID | None = None,
) -> list[FaceProfile]:
    statement = (
        select(FaceEmbedding)
        .join(FaceEmbedding.student)
        .options(selectinload(FaceEmbedding.student).selectinload(Student.classroom))
        .where(
            FaceEmbedding.school_id == school_id,
            FaceEmbedding.model_version == MODEL_VERSION,
            Student.school_id == school_id,
            Student.status == "active",
        )
    )
    if exclude_student_id is not None:
        statement = statement.where(FaceEmbedding.student_id != exclude_student_id)

    grouped: dict[UUID, list[FaceTemplate]] = defaultdict(list)
    students: dict[UUID, Student] = {}
    for stored in session.scalars(statement).all():
        normalized = _normalize_stored_embedding(
            stored.embedding,
            expected_dimension=expected_dimension,
        )
        if normalized is None:
            continue
        try:
            pose = EnrollmentPose(stored.enrollment_pose) if stored.enrollment_pose else None
        except ValueError:
            pose = None
        grouped[stored.student_id].append(FaceTemplate(pose=pose, embedding=normalized))
        students[stored.student_id] = stored.student

    return [
        FaceProfile(student=students[student_id], templates=tuple(templates))
        for student_id, templates in grouped.items()
        if templates
    ]


def _profile_similarity(
    analysis: FrameAnalysis,
    profile: FaceProfile,
    *,
    pose: EnrollmentPose | None,
) -> float:
    same_pose = [template for template in profile.templates if template.pose == pose]
    candidates = same_pose if pose is not None and len(same_pose) >= 2 else profile.templates
    similarities = sorted(
        (float(np.dot(analysis.embedding, template.embedding)) for template in candidates),
        reverse=True,
    )
    top_count = min(2, len(similarities))
    return float(np.mean(similarities[:top_count]))


def find_duplicate_profile(
    profiles: list[FaceProfile],
    enrolled: list[tuple[EnrollmentPose | None, FrameAnalysis]],
    *,
    frame_threshold: float,
    median_threshold: float,
    required_ratio: float,
) -> CandidateScore | None:
    if not profiles or not enrolled:
        return None
    required_frames = math.ceil(len(enrolled) * required_ratio)
    conflicts: list[CandidateScore] = []
    for profile in profiles:
        scores = [
            _profile_similarity(analysis, profile, pose=pose) for pose, analysis in enrolled
        ]
        median_score = float(np.median(scores))
        agreeing_frames = sum(score >= frame_threshold for score in scores)
        if median_score >= median_threshold and agreeing_frames >= required_frames:
            conflicts.append(
                CandidateScore(
                    profile=profile,
                    median_score=median_score,
                    agreeing_frames=agreeing_frames,
                )
            )
    if not conflicts:
        return None
    return max(conflicts, key=lambda item: (item.median_score, item.agreeing_frames))


def rank_recognition_candidates(
    profiles: list[FaceProfile],
    analyses: list[FrameAnalysis],
    *,
    frame_threshold: float,
) -> list[CandidateScore]:
    if not profiles or not analyses:
        return []

    scores_by_student: dict[UUID, list[float]] = defaultdict(list)
    votes: Counter[UUID] = Counter()
    profiles_by_id = {profile.student.id: profile for profile in profiles}
    for analysis in analyses:
        frame_scores = {
            profile.student.id: _profile_similarity(analysis, profile, pose=None)
            for profile in profiles
        }
        for student_id, score in frame_scores.items():
            scores_by_student[student_id].append(score)
        winner_id, winner_score = max(frame_scores.items(), key=lambda item: item[1])
        if winner_score >= frame_threshold:
            votes[winner_id] += 1

    ranked = [
        CandidateScore(
            profile=profiles_by_id[student_id],
            median_score=float(np.median(scores)),
            agreeing_frames=votes[student_id],
        )
        for student_id, scores in scores_by_student.items()
    ]
    return sorted(ranked, key=lambda item: item.median_score, reverse=True)

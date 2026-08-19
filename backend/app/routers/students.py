from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.audit import append_audit_log
from app.dependencies import CurrentUser, DbSession, require_roles
from app.enums import UserRole
from app.models import Classroom, Occurrence, Student, User
from app.normalization import normalize_search_text, student_search_text
from app.schemas import OccurrenceCreate, OccurrenceRead, StudentCreate, StudentRead
from app.serializers import occurrence_to_read, student_to_read

router = APIRouter(prefix="/api/v1/students", tags=["students"])
OccurrenceWriter = Annotated[
    User,
    Depends(require_roles(UserRole.ADMIN, UserRole.COORDINATOR)),
]
StudentWriter = Annotated[User, Depends(require_roles(UserRole.ADMIN))]


def get_student_or_404(session: DbSession, student_id: UUID, school_id: UUID) -> Student:
    student = session.scalar(
        select(Student)
        .options(selectinload(Student.classroom))
        .where(Student.id == student_id, Student.school_id == school_id)
    )
    if student is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Aluno não encontrado")
    return student


@router.get("", response_model=list[StudentRead])
def search_students(
    session: DbSession,
    user: CurrentUser,
    query: Annotated[str, Query(alias="q", max_length=160)] = "",
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[StudentRead]:
    terms = normalize_search_text(query).split()
    statement = (
        select(Student)
        .options(selectinload(Student.classroom))
        .where(Student.school_id == user.school_id, Student.status == "active")
        .order_by(Student.name)
        .limit(limit)
    )
    for term in terms:
        statement = statement.where(Student.search_text.contains(term))
    return [student_to_read(student) for student in session.scalars(statement).all()]


@router.post("", response_model=StudentRead, status_code=status.HTTP_201_CREATED)
def create_student(
    payload: StudentCreate,
    session: DbSession,
    user: StudentWriter,
) -> StudentRead:
    classroom = session.scalar(
        select(Classroom).where(
            Classroom.id == payload.classroom_id,
            Classroom.school_id == user.school_id,
            Classroom.is_active.is_(True),
        )
    )
    if classroom is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Turma não encontrada")

    name = payload.name.strip()
    preferred_name = payload.preferred_name.strip() if payload.preferred_name else None
    enrollment_code = payload.enrollment_code.strip()
    student = Student(
        school_id=user.school_id,
        classroom_id=classroom.id,
        name=name,
        preferred_name=preferred_name,
        enrollment_code=enrollment_code,
        search_text=student_search_text(
            name=name,
            preferred_name=preferred_name,
            enrollment_code=enrollment_code,
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
    append_audit_log(
        session,
        actor=user,
        action="student.created",
        entity_type="student",
        entity_id=student.id,
        details={"enrollmentCode": student.enrollment_code},
    )
    session.commit()
    student.classroom = classroom
    return student_to_read(student)


@router.get("/{student_id}", response_model=StudentRead)
def get_student(student_id: UUID, session: DbSession, user: CurrentUser) -> StudentRead:
    return student_to_read(get_student_or_404(session, student_id, user.school_id))


@router.get("/{student_id}/occurrences", response_model=list[OccurrenceRead])
def list_occurrences(
    student_id: UUID,
    session: DbSession,
    user: CurrentUser,
) -> list[OccurrenceRead]:
    get_student_or_404(session, student_id, user.school_id)
    statement = (
        select(Occurrence)
        .options(selectinload(Occurrence.created_by), selectinload(Occurrence.attachment))
        .where(
            Occurrence.student_id == student_id,
            Occurrence.school_id == user.school_id,
        )
        .order_by(Occurrence.occurred_at.desc())
        .limit(100)
    )
    return [occurrence_to_read(item) for item in session.scalars(statement).all()]


@router.post(
    "/{student_id}/occurrences",
    response_model=OccurrenceRead,
    status_code=status.HTTP_201_CREATED,
)
def create_occurrence(
    student_id: UUID,
    payload: OccurrenceCreate,
    session: DbSession,
    user: OccurrenceWriter,
) -> OccurrenceRead:
    get_student_or_404(session, student_id, user.school_id)
    occurrence = Occurrence(
        school_id=user.school_id,
        student_id=student_id,
        type=payload.type.value,
        reason=payload.reason,
        description=payload.description.strip() if payload.description else None,
        responsible_name=(payload.responsible_name.strip() if payload.responsible_name else None),
        participants=payload.participants.strip() if payload.participants else None,
        occurred_at=payload.occurred_at,
        created_by_id=user.id,
        identification_source=payload.identification_source.value,
    )
    session.add(occurrence)
    session.flush()
    append_audit_log(
        session,
        actor=user,
        action="occurrence.created",
        entity_type="occurrence",
        entity_id=occurrence.id,
        details={"studentId": str(student_id), "type": occurrence.type},
    )
    session.commit()
    occurrence.created_by = user
    return occurrence_to_read(occurrence)

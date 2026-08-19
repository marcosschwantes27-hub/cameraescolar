from app.enums import (
    FaceEnrollmentStatus,
    IdentificationSource,
    OccurrenceStatus,
    OccurrenceType,
    Shift,
    StudentStatus,
    UserRole,
)
from app.models import Occurrence, Student, User
from app.schemas import (
    AttachmentRead,
    CreatedByRead,
    OccurrenceRead,
    StudentRead,
    UserRead,
)


def initials(name: str) -> str:
    parts = name.split()
    if not parts:
        return "?"
    if len(parts) == 1:
        return parts[0][0].upper()
    return f"{parts[0][0]}{parts[-1][0]}".upper()


def user_to_read(user: User) -> UserRead:
    return UserRead(
        id=user.id,
        school_id=user.school_id,
        email=user.email,
        full_name=user.full_name,
        role=UserRole(user.role),
    )


def student_to_read(student: Student) -> StudentRead:
    return StudentRead(
        id=student.id,
        school_id=student.school_id,
        name=student.name,
        preferred_name=student.preferred_name,
        enrollment_code=student.enrollment_code,
        classroom=student.classroom.name,
        shift=Shift(student.classroom.shift),
        status=StudentStatus(student.status),
        initials=initials(student.name),
        face_enrollment_status=FaceEnrollmentStatus(student.face_enrollment_status),
    )


def occurrence_to_read(occurrence: Occurrence) -> OccurrenceRead:
    attachment = occurrence.attachment
    return OccurrenceRead(
        id=occurrence.id,
        school_id=occurrence.school_id,
        student_id=occurrence.student_id,
        type=OccurrenceType(occurrence.type),
        reason=occurrence.reason,
        description=occurrence.description,
        responsible_name=occurrence.responsible_name,
        participants=occurrence.participants,
        attachment=(
            AttachmentRead(
                id=attachment.id,
                name=attachment.original_name,
                size=attachment.size_bytes,
                media_type=attachment.media_type,
            )
            if attachment is not None
            else None
        ),
        occurred_at=occurrence.occurred_at,
        created_at=occurrence.created_at,
        created_by=CreatedByRead(
            id=occurrence.created_by.id,
            name=occurrence.created_by.full_name,
        ),
        identification_source=IdentificationSource(occurrence.identification_source),
        status=OccurrenceStatus(occurrence.status),
    )

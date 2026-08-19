from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.enums import (
    FaceEnrollmentStatus,
    IdentificationSource,
    OccurrenceStatus,
    OccurrenceType,
    Shift,
    StudentStatus,
    UserRole,
)


def to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(word.capitalize() for word in rest)


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class LoginRequest(ApiModel):
    school_code: str = Field(min_length=2, max_length=40)
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=200)


class TokenResponse(ApiModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class UserRead(ApiModel):
    id: UUID
    school_id: UUID
    email: str
    full_name: str
    role: UserRole


class StudentCreate(ApiModel):
    name: str = Field(min_length=2, max_length=160)
    preferred_name: str | None = Field(default=None, max_length=100)
    enrollment_code: str = Field(min_length=1, max_length=60)
    classroom_id: UUID


class StudentRead(ApiModel):
    id: UUID
    school_id: UUID
    name: str
    preferred_name: str | None
    enrollment_code: str
    classroom: str
    shift: Shift
    status: StudentStatus
    initials: str
    face_enrollment_status: FaceEnrollmentStatus


class ClassroomRead(ApiModel):
    id: UUID
    name: str
    academic_year: int
    shift: Shift


class FaceEnrollmentRead(ApiModel):
    student: StudentRead
    frames_received: int
    frames_accepted: int
    model_version: str


class FaceRecognitionRead(ApiModel):
    matched: bool
    student: StudentRead | None
    similarity: float | None
    frames_analyzed: int
    agreeing_frames: int
    message: str


class AttachmentRead(ApiModel):
    id: UUID
    name: str
    size: int
    media_type: str


class CreatedByRead(ApiModel):
    id: UUID
    name: str


class OccurrenceCreate(ApiModel):
    type: OccurrenceType
    reason: str = Field(min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=10_000)
    responsible_name: str | None = Field(default=None, max_length=160)
    participants: str | None = Field(default=None, max_length=2_000)
    occurred_at: datetime
    identification_source: IdentificationSource = IdentificationSource.MANUAL

    @field_validator("occurred_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("occurredAt deve incluir fuso horário")
        return value

    @field_validator("reason")
    @classmethod
    def strip_reason(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("reason não pode ficar em branco")
        return stripped


class OccurrenceRead(ApiModel):
    id: UUID
    school_id: UUID
    student_id: UUID
    type: OccurrenceType
    reason: str
    description: str | None
    responsible_name: str | None
    participants: str | None
    attachment: AttachmentRead | None
    occurred_at: datetime
    created_at: datetime
    created_by: CreatedByRead
    identification_source: IdentificationSource
    status: OccurrenceStatus


class HealthRead(ApiModel):
    status: str

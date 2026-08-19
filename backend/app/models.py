from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class School(Base):
    __tablename__ = "schools"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(160))
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    users: Mapped[list[User]] = relationship(back_populates="school")
    classrooms: Mapped[list[Classroom]] = relationship(back_populates="school")
    students: Mapped[list[Student]] = relationship(back_populates="school")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("school_id", "email", name="uq_users_school_email"),
        CheckConstraint(
            "role IN ('admin', 'coordinator', 'viewer')",
            name="valid_role",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    school_id: Mapped[UUID] = mapped_column(
        ForeignKey("schools.id", ondelete="RESTRICT"), index=True
    )
    email: Mapped[str] = mapped_column(String(254))
    full_name: Mapped[str] = mapped_column(String(160))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(24))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    school: Mapped[School] = relationship(back_populates="users")
    created_occurrences: Mapped[list[Occurrence]] = relationship(back_populates="created_by")


class Classroom(Base):
    __tablename__ = "classrooms"
    __table_args__ = (
        UniqueConstraint(
            "school_id", "academic_year", "name", "shift", name="uq_classrooms_identity"
        ),
        CheckConstraint("shift IN ('Manhã', 'Tarde', 'Noite')", name="valid_shift"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    school_id: Mapped[UUID] = mapped_column(
        ForeignKey("schools.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(String(80))
    academic_year: Mapped[int] = mapped_column(Integer)
    shift: Mapped[str] = mapped_column(String(16))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    school: Mapped[School] = relationship(back_populates="classrooms")
    students: Mapped[list[Student]] = relationship(back_populates="classroom")


class Student(Base):
    __tablename__ = "students"
    __table_args__ = (
        UniqueConstraint("school_id", "enrollment_code", name="uq_students_enrollment"),
        CheckConstraint("status IN ('active', 'inactive')", name="valid_status"),
        CheckConstraint(
            "face_enrollment_status IN ('not_enrolled', 'enrolled', 'review_needed')",
            name="valid_face_status",
        ),
        Index("ix_students_school_search_text", "school_id", "search_text"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    school_id: Mapped[UUID] = mapped_column(
        ForeignKey("schools.id", ondelete="RESTRICT"), index=True
    )
    classroom_id: Mapped[UUID] = mapped_column(
        ForeignKey("classrooms.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(String(160))
    preferred_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    enrollment_code: Mapped[str] = mapped_column(String(60))
    search_text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="active", server_default="active")
    face_enrollment_status: Mapped[str] = mapped_column(
        String(24), default="not_enrolled", server_default="not_enrolled"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    school: Mapped[School] = relationship(back_populates="students")
    classroom: Mapped[Classroom] = relationship(back_populates="students")
    occurrences: Mapped[list[Occurrence]] = relationship(back_populates="student")
    face_embeddings: Mapped[list[FaceEmbedding]] = relationship(
        back_populates="student", cascade="all, delete-orphan"
    )


class FaceEmbedding(Base):
    __tablename__ = "face_embeddings"
    __table_args__ = (
        Index("ix_face_embeddings_school_student", "school_id", "student_id"),
        CheckConstraint("quality_score >= 0 AND quality_score <= 1", name="valid_quality"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    school_id: Mapped[UUID] = mapped_column(
        ForeignKey("schools.id", ondelete="RESTRICT"), index=True
    )
    student_id: Mapped[UUID] = mapped_column(
        ForeignKey("students.id", ondelete="CASCADE"), index=True
    )
    embedding: Mapped[list[float]] = mapped_column(ARRAY(Float), nullable=False)
    quality_score: Mapped[float] = mapped_column(Float)
    model_version: Mapped[str] = mapped_column(String(80))
    enrollment_pose: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    student: Mapped[Student] = relationship(back_populates="face_embeddings")


class Occurrence(Base):
    __tablename__ = "occurrences"
    __table_args__ = (
        CheckConstraint(
            "type IN ('late_arrival', 'early_departure', 'school_record', "
            "'meeting_minutes', 'warning')",
            name="valid_type",
        ),
        CheckConstraint(
            "identification_source IN ('manual', 'facial')",
            name="valid_identification_source",
        ),
        CheckConstraint("status IN ('active', 'cancelled')", name="valid_status"),
        Index("ix_occurrences_student_occurred_at", "student_id", "occurred_at"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    school_id: Mapped[UUID] = mapped_column(
        ForeignKey("schools.id", ondelete="RESTRICT"), index=True
    )
    student_id: Mapped[UUID] = mapped_column(
        ForeignKey("students.id", ondelete="RESTRICT"), index=True
    )
    type: Mapped[str] = mapped_column(String(32))
    reason: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    responsible_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    participants: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    identification_source: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="active", server_default="active")

    student: Mapped[Student] = relationship(back_populates="occurrences")
    created_by: Mapped[User] = relationship(back_populates="created_occurrences")
    attachment: Mapped[Attachment | None] = relationship(
        back_populates="occurrence", uselist=False, cascade="all, delete-orphan"
    )


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    school_id: Mapped[UUID] = mapped_column(
        ForeignKey("schools.id", ondelete="RESTRICT"), index=True
    )
    occurrence_id: Mapped[UUID] = mapped_column(
        ForeignKey("occurrences.id", ondelete="CASCADE"), unique=True, index=True
    )
    storage_key: Mapped[str] = mapped_column(String(500))
    original_name: Mapped[str] = mapped_column(String(255))
    media_type: Mapped[str] = mapped_column(String(120))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    occurrence: Mapped[Occurrence] = relationship(back_populates="attachment")


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_logs_school_occurred_at", "school_id", "occurred_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    school_id: Mapped[UUID] = mapped_column(
        ForeignKey("schools.id", ondelete="RESTRICT"), index=True
    )
    actor_user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    action: Mapped[str] = mapped_column(String(80))
    entity_type: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[UUID] = mapped_column()
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    details: Mapped[dict[str, Any]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), default=dict
    )

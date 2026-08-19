import secrets
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.database import SessionLocal
from app.enums import Shift, UserRole
from app.models import Classroom, School, User
from app.security import hash_password


def bootstrap_local_school(session: Session, school_code: str) -> School:
    code = school_code.strip().upper()
    school = session.scalar(select(School).where(School.code == code))
    if school is None:
        school = School(name="Escola Estadual Horizonte", code=code)
        session.add(school)
        session.flush()

    user = session.scalar(select(User).where(User.school_id == school.id).limit(1))
    if user is None:
        session.add(
            User(
                school_id=school.id,
                email=f"local-{school.id}@invalid.local",
                full_name="Marina Souza",
                password_hash=hash_password(secrets.token_urlsafe(48)),
                role=UserRole.ADMIN.value,
            )
        )

    classroom_specs = [
        ("8º ano B", Shift.MORNING.value),
        ("9º ano A", Shift.MORNING.value),
        ("7º ano C", Shift.AFTERNOON.value),
    ]
    academic_year = datetime.now(UTC).year
    existing = {
        (classroom.name, classroom.shift)
        for classroom in session.scalars(
            select(Classroom).where(
                Classroom.school_id == school.id,
                Classroom.academic_year == academic_year,
            )
        ).all()
    }
    session.add_all(
        [
            Classroom(
                school_id=school.id,
                name=name,
                academic_year=academic_year,
                shift=shift,
            )
            for name, shift in classroom_specs
            if (name, shift) not in existing
        ]
    )
    return school


def ensure_local_school(settings: Settings) -> None:
    if settings.auth_required or not settings.bootstrap_local_school:
        return
    with SessionLocal.begin() as session:
        bootstrap_local_school(session, settings.demo_school_code)

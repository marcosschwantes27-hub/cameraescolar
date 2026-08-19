from sqlalchemy import func, select
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

from app.local_bootstrap import bootstrap_local_school
from app.models import Classroom, Occurrence, School, Student, User


def test_local_bootstrap_creates_structure_without_students(connection: Connection) -> None:
    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        school = bootstrap_local_school(session, "NOVA-DEMO")
        session.flush()
        bootstrap_local_school(session, "NOVA-DEMO")
        session.flush()

        assert session.scalar(
            select(func.count()).select_from(School).where(School.id == school.id)
        ) == 1
        assert session.scalar(
            select(func.count()).select_from(User).where(User.school_id == school.id)
        ) == 1
        assert session.scalar(
            select(func.count()).select_from(Classroom).where(Classroom.school_id == school.id)
        ) == 3
        assert session.scalar(
            select(func.count()).select_from(Student).where(Student.school_id == school.id)
        ) == 0
        assert session.scalar(
            select(func.count()).select_from(Occurrence).where(Occurrence.school_id == school.id)
        ) == 0

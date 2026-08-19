import os
from collections.abc import Generator
from dataclasses import dataclass
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

os.environ.setdefault("REGISTRO_ENVIRONMENT", "test")
os.environ.setdefault("REGISTRO_AUTH_REQUIRED", "true")
os.environ.setdefault("REGISTRO_BOOTSTRAP_LOCAL_SCHOOL", "false")
os.environ.setdefault(
    "REGISTRO_DATABASE_URL",
    "postgresql+psycopg://registro_escolar:registro-dev-password@127.0.0.1:54329/registro_escolar",
)
os.environ.setdefault(
    "REGISTRO_JWT_SECRET",
    "test-only-secret-with-at-least-32-characters",
)

from app.database import engine, get_db
from app.enums import Shift, UserRole
from app.main import app
from app.models import Classroom, School, Student, User
from app.normalization import student_search_text
from app.security import hash_password


@dataclass(frozen=True)
class SeedData:
    school_id: UUID
    other_school_id: UUID
    student_id: UUID
    other_student_id: UUID
    admin_id: UUID
    email: str
    password: str


@pytest.fixture
def connection() -> Generator[Connection]:
    with engine.connect() as database_connection:
        transaction = database_connection.begin()
        yield database_connection
        transaction.rollback()


@pytest.fixture
def seed_data(connection: Connection) -> SeedData:
    password = "senha-segura-123"
    email = "coordenacao@escola.test"
    with Session(
        bind=connection,
        join_transaction_mode="create_savepoint",
        expire_on_commit=False,
    ) as session:
        school = School(name="Escola Estadual Exemplo", code="ESCOLA1")
        other_school = School(name="Outra Escola", code="ESCOLA2")
        session.add_all([school, other_school])
        session.flush()

        classroom = Classroom(
            school_id=school.id,
            name="2º B",
            academic_year=2026,
            shift=Shift.MORNING.value,
        )
        other_classroom = Classroom(
            school_id=other_school.id,
            name="3º A",
            academic_year=2026,
            shift=Shift.AFTERNOON.value,
        )
        admin = User(
            school_id=school.id,
            email=email,
            full_name="Maria Coordenadora",
            password_hash=hash_password(password),
            role=UserRole.ADMIN.value,
        )
        session.add_all([classroom, other_classroom, admin])
        session.flush()

        student = Student(
            school_id=school.id,
            classroom_id=classroom.id,
            name="Ana Júlia Nascimento",
            preferred_name="Ana",
            enrollment_code="20260001",
            search_text=student_search_text(
                name="Ana Júlia Nascimento",
                preferred_name="Ana",
                enrollment_code="20260001",
            ),
        )
        other_student = Student(
            school_id=other_school.id,
            classroom_id=other_classroom.id,
            name="Aluno de Outra Escola",
            preferred_name=None,
            enrollment_code="OUTRA-1",
            search_text=student_search_text(
                name="Aluno de Outra Escola",
                preferred_name=None,
                enrollment_code="OUTRA-1",
            ),
        )
        session.add_all([student, other_student])
        session.commit()

        return SeedData(
            school_id=school.id,
            other_school_id=other_school.id,
            student_id=student.id,
            other_student_id=other_student.id,
            admin_id=admin.id,
            email=email,
            password=password,
        )


@pytest.fixture
def client(connection: Connection, seed_data: SeedData) -> Generator[TestClient]:
    del seed_data

    def override_get_db() -> Generator[Session]:
        with Session(
            bind=connection,
            join_transaction_mode="create_savepoint",
            expire_on_commit=False,
        ) as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def auth_headers(client: TestClient, seed_data: SeedData) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={
            "schoolCode": "escola1",
            "email": seed_data.email.upper(),
            "password": seed_data.password,
        },
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}

from uuid import UUID

import numpy as np
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

from app.enums import EnrollmentPose
from app.face_service import FrameAnalysis, get_face_service
from app.main import app
from app.models import AuditLog, FaceEmbedding, Occurrence, Student
from tests.conftest import SeedData


class FakeFaceService:
    def analyze(self, frame: bytes) -> FrameAnalysis:
        raw = frame.decode(errors="ignore")
        pose_name = raw.split("|", maxsplit=1)[0]
        pose_metrics = {
            EnrollmentPose.FRONT.value: (0.0, 0.55),
            EnrollmentPose.LEFT.value: (-0.16, 0.55),
            EnrollmentPose.RIGHT.value: (0.16, 0.55),
            EnrollmentPose.UP.value: (0.0, 0.66),
            EnrollmentPose.DOWN.value: (0.0, 0.44),
        }
        yaw_offset, pitch_ratio = pose_metrics.get(pose_name, (0.0, 0.55))
        embedding = np.zeros(128, dtype=np.float32)
        embedding[1 if "face-b" in raw else 0] = 1
        return FrameAnalysis(
            embedding=embedding,
            quality=0.95,
            yaw_offset=yaw_offset,
            pitch_ratio=pitch_ratio,
        )

    def analyze_frames(self, frames: list[bytes]) -> tuple[list[FrameAnalysis], list[str]]:
        return [self.analyze(frame) for frame in frames], []

    def remove_outliers(self, analyses: list[FrameAnalysis]) -> list[FrameAnalysis]:
        return analyses


def guided_capture(
    identity: str = "face-a",
) -> tuple[list[str], list[tuple[str, tuple[str, bytes, str]]]]:
    poses = [pose.value for pose in EnrollmentPose for _ in range(3)]
    files = [
        (
            "frames",
            (
                f"frame-{index}.jpg",
                f"{pose}|{identity}|{index}".encode(),
                "image/jpeg",
            ),
        )
        for index, pose in enumerate(poses, start=1)
    ]
    return poses, files


def test_students_require_authentication(client: TestClient) -> None:
    response = client.get("/api/v1/students", params={"q": "Ana"})
    assert response.status_code == 401


def test_login_and_search_are_accent_insensitive(
    client: TestClient,
    auth_headers: dict[str, str],
    seed_data: SeedData,
) -> None:
    response = client.get(
        "/api/v1/students",
        params={"q": "ana julia nascimento"},
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": str(seed_data.student_id),
            "schoolId": str(seed_data.school_id),
            "name": "Ana Júlia Nascimento",
            "preferredName": "Ana",
            "enrollmentCode": "20260001",
            "classroom": "2º B",
            "shift": "Manhã",
            "status": "active",
            "initials": "AN",
            "faceEnrollmentStatus": "not_enrolled",
        }
    ]


def test_occurrence_is_created_listed_and_audited(
    client: TestClient,
    auth_headers: dict[str, str],
    seed_data: SeedData,
    connection: Connection,
) -> None:
    response = client.post(
        f"/api/v1/students/{seed_data.student_id}/occurrences",
        headers=auth_headers,
        json={
            "type": "late_arrival",
            "reason": "Problema com o transporte escolar",
            "description": "Aluno chegou após o início da primeira aula.",
            "occurredAt": "2026-08-18T08:10:00-03:00",
            "identificationSource": "manual",
        },
    )

    assert response.status_code == 201
    created = response.json()
    assert created["studentId"] == str(seed_data.student_id)
    assert created["type"] == "late_arrival"
    assert created["createdBy"]["name"] == "Maria Coordenadora"

    history = client.get(
        f"/api/v1/students/{seed_data.student_id}/occurrences",
        headers=auth_headers,
    )
    assert history.status_code == 200
    assert [item["id"] for item in history.json()] == [created["id"]]

    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(Occurrence)
                .where(Occurrence.school_id == seed_data.school_id)
            )
            == 1
        )
        audit = session.scalar(
            select(AuditLog).where(
                AuditLog.action == "occurrence.created",
                AuditLog.entity_id == UUID(created["id"]),
            )
        )
        assert audit is not None
        assert audit.school_id == seed_data.school_id


def test_user_cannot_read_student_from_another_school(
    client: TestClient,
    auth_headers: dict[str, str],
    seed_data: SeedData,
) -> None:
    response = client.get(
        f"/api/v1/students/{seed_data.other_student_id}",
        headers=auth_headers,
    )
    assert response.status_code == 404


def test_face_enrollment_and_multiframe_recognition(
    client: TestClient,
    auth_headers: dict[str, str],
    seed_data: SeedData,
) -> None:
    app.dependency_overrides[get_face_service] = lambda: FakeFaceService()
    files = [
        ("frames", (f"frame-{index}.jpg", f"camera-{index}".encode(), "image/jpeg"))
        for index in range(3)
    ]

    enrollment = client.post(
        f"/api/v1/students/{seed_data.student_id}/face-enrollment",
        headers=auth_headers,
        files=files,
    )
    assert enrollment.status_code == 200
    assert enrollment.json()["framesAccepted"] == 3
    assert enrollment.json()["student"]["faceEnrollmentStatus"] == "enrolled"

    recognition = client.post(
        "/api/v1/recognition/identify",
        headers=auth_headers,
        files=files,
    )
    assert recognition.status_code == 200
    assert recognition.json()["matched"] is True
    assert recognition.json()["student"]["id"] == str(seed_data.student_id)
    assert recognition.json()["agreeingFrames"] == 3


def test_guided_face_enrollment_stores_all_five_poses(
    client: TestClient,
    auth_headers: dict[str, str],
    seed_data: SeedData,
    connection: Connection,
) -> None:
    app.dependency_overrides[get_face_service] = lambda: FakeFaceService()
    poses, files = guided_capture()

    enrollment = client.post(
        f"/api/v1/students/{seed_data.student_id}/face-enrollment",
        headers=auth_headers,
        data={"poses": poses},
        files=files,
    )

    assert enrollment.status_code == 200
    assert enrollment.json()["framesReceived"] == 15
    assert enrollment.json()["framesAccepted"] == 10
    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        templates = session.scalars(
            select(FaceEmbedding).where(FaceEmbedding.student_id == seed_data.student_id)
        ).all()
        assert len(templates) == 10
        assert {template.enrollment_pose for template in templates} == set(poses)


def test_duplicate_face_does_not_create_a_second_student(
    client: TestClient,
    auth_headers: dict[str, str],
    seed_data: SeedData,
    connection: Connection,
) -> None:
    app.dependency_overrides[get_face_service] = lambda: FakeFaceService()
    poses, files = guided_capture("face-a")
    first = client.post(
        f"/api/v1/students/{seed_data.student_id}/face-enrollment",
        headers=auth_headers,
        data={"poses": poses},
        files=files,
    )
    assert first.status_code == 200

    duplicate = client.post(
        "/api/v1/student-face-enrollments",
        headers=auth_headers,
        data={
            "name": "Outra Ana",
            "enrollmentCode": "20260002",
            "classroomId": str(
                connection.execute(
                    select(Student.classroom_id).where(Student.id == seed_data.student_id)
                ).scalar_one()
            ),
            "poses": poses,
        },
        files=files,
    )

    assert duplicate.status_code == 409
    assert "Possível rosto já cadastrado para Ana Júlia Nascimento" in duplicate.json()["detail"]
    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        assert session.scalar(
            select(func.count())
            .select_from(Student)
            .where(Student.enrollment_code == "20260002")
        ) == 0
        assert session.scalar(
            select(func.count())
            .select_from(FaceEmbedding)
            .where(FaceEmbedding.student_id == seed_data.student_id)
        ) == 10


def test_atomic_face_enrollment_creates_student_with_distinct_face(
    client: TestClient,
    auth_headers: dict[str, str],
    seed_data: SeedData,
    connection: Connection,
) -> None:
    app.dependency_overrides[get_face_service] = lambda: FakeFaceService()
    poses, files = guided_capture("face-b")
    classroom_id = connection.execute(
        select(Student.classroom_id).where(Student.id == seed_data.student_id)
    ).scalar_one()

    response = client.post(
        "/api/v1/student-face-enrollments",
        headers=auth_headers,
        data={
            "name": "Bruno Ferreira",
            "preferredName": "Bruno",
            "enrollmentCode": "20260002",
            "classroomId": str(classroom_id),
            "poses": poses,
        },
        files=files,
    )

    assert response.status_code == 201
    created = response.json()
    assert created["framesReceived"] == 15
    assert created["framesAccepted"] == 10
    assert created["student"]["faceEnrollmentStatus"] == "enrolled"
    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        student_id = UUID(created["student"]["id"])
        assert session.scalar(
            select(func.count())
            .select_from(FaceEmbedding)
            .where(FaceEmbedding.student_id == student_id)
        ) == 10


def test_face_reenrollment_excludes_the_same_student_from_duplicate_check(
    client: TestClient,
    auth_headers: dict[str, str],
    seed_data: SeedData,
) -> None:
    app.dependency_overrides[get_face_service] = lambda: FakeFaceService()
    poses, files = guided_capture("face-a")

    for _ in range(2):
        response = client.post(
            f"/api/v1/students/{seed_data.student_id}/face-enrollment",
            headers=auth_headers,
            data={"poses": poses},
            files=files,
        )
        assert response.status_code == 200

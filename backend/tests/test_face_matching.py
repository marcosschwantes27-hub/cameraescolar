from uuid import uuid4

import numpy as np

from app.enums import EnrollmentPose
from app.face_matching import FaceProfile, FaceTemplate, find_duplicate_profile
from app.face_service import FrameAnalysis
from app.models import Student


def embedding(index: int) -> np.ndarray[tuple[int], np.dtype[np.float32]]:
    vector = np.zeros(128, dtype=np.float32)
    vector[index] = 1
    return vector


def profile_for(vector: np.ndarray[tuple[int], np.dtype[np.float32]]) -> FaceProfile:
    school_id = uuid4()
    student = Student(
        id=uuid4(),
        school_id=school_id,
        classroom_id=uuid4(),
        name="Aluno existente",
        preferred_name=None,
        enrollment_code="A-1",
        search_text="aluno existente a 1",
    )
    return FaceProfile(
        student=student,
        templates=(
            FaceTemplate(pose=EnrollmentPose.FRONT, embedding=vector),
            FaceTemplate(pose=EnrollmentPose.FRONT, embedding=vector),
        ),
    )


def test_one_similar_frame_is_not_enough_to_block_enrollment() -> None:
    same = embedding(0)
    different = embedding(1)
    enrolled: list[tuple[EnrollmentPose | None, FrameAnalysis]] = [
        (
            EnrollmentPose.FRONT,
            FrameAnalysis(embedding=same if index == 0 else different, quality=0.95),
        )
        for index in range(10)
    ]

    duplicate = find_duplicate_profile(
        [profile_for(same)],
        enrolled,
        frame_threshold=0.55,
        median_threshold=0.60,
        required_ratio=0.70,
    )

    assert duplicate is None


def test_consistent_multiframe_match_blocks_duplicate_enrollment() -> None:
    same = embedding(0)
    enrolled: list[tuple[EnrollmentPose | None, FrameAnalysis]] = [
        (EnrollmentPose.FRONT, FrameAnalysis(embedding=same, quality=0.95))
        for _ in range(10)
    ]

    duplicate = find_duplicate_profile(
        [profile_for(same)],
        enrolled,
        frame_threshold=0.55,
        median_threshold=0.60,
        required_ratio=0.70,
    )

    assert duplicate is not None
    assert duplicate.agreeing_frames == 10
    assert duplicate.median_score == 1.0

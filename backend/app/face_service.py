from __future__ import annotations

import hashlib
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from threading import Lock

import cv2 as cv
import numpy as np
from numpy.typing import NDArray

MODEL_VERSION = "sface-2021dec"
MODEL_DIR = Path(__file__).resolve().parents[1] / "models"
YUNET_MODEL = MODEL_DIR / "face_detection_yunet_2023mar.onnx"
SFACE_MODEL = MODEL_DIR / "face_recognition_sface_2021dec.onnx"
EXPECTED_HASHES = {
    YUNET_MODEL: "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    SFACE_MODEL: "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
}


class FaceProcessingError(ValueError):
    pass


@dataclass(frozen=True)
class FrameAnalysis:
    embedding: NDArray[np.float32]
    quality: float
    yaw_offset: float = 0.0
    pitch_ratio: float = 0.55
    detection_score: float = 1.0
    sharpness: float = 1.0
    brightness: float = 130.0
    face_area_ratio: float = 0.2


def cosine_similarity(left: NDArray[np.float32], right: NDArray[np.float32]) -> float:
    return float(np.dot(left, right))


class FaceService:
    def __init__(self) -> None:
        self._validate_models()
        self._detector = cv.FaceDetectorYN.create(
            str(YUNET_MODEL),
            "",
            (320, 320),
            0.9,
            0.3,
            5000,
        )
        self._recognizer = cv.FaceRecognizerSF.create(str(SFACE_MODEL), "")
        self._lock = Lock()

    @staticmethod
    def _validate_models() -> None:
        for path, expected_hash in EXPECTED_HASHES.items():
            if not path.is_file():
                raise RuntimeError(f"Modelo facial ausente: {path.name}")
            actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
            if actual_hash != expected_hash:
                raise RuntimeError(f"Hash inválido para o modelo facial: {path.name}")

    @staticmethod
    def decode_image(data: bytes) -> NDArray[np.uint8]:
        encoded = np.frombuffer(data, dtype=np.uint8)
        image = cv.imdecode(encoded, cv.IMREAD_COLOR)
        if image is None or image.size == 0:
            raise FaceProcessingError("Imagem inválida ou não suportada")
        return np.asarray(image, dtype=np.uint8)

    def analyze(self, data: bytes) -> FrameAnalysis:
        image = self.decode_image(data)
        height, width = image.shape[:2]
        if min(width, height) < 360 or max(width, height) < 480:
            raise FaceProcessingError("A câmera precisa fornecer pelo menos 480 x 360 pixels")

        with self._lock:
            self._detector.setInputSize((width, height))
            _, faces = self._detector.detect(image)
            if faces is None or len(faces) == 0:
                raise FaceProcessingError("Nenhum rosto foi encontrado")
            if len(faces) > 1:
                raise FaceProcessingError("Apenas uma pessoa deve aparecer na câmera")

            face = np.asarray(faces[0], dtype=np.float32)
            detection_score = float(face[14])
            if detection_score < 0.92:
                raise FaceProcessingError("O rosto não foi detectado com nitidez suficiente")

            face_width = float(face[2])
            face_height = float(face[3])
            if min(face_width, face_height) < 120:
                raise FaceProcessingError("Aproxime o rosto da câmera")
            face_area_ratio = (face_width * face_height) / float(width * height)
            if face_area_ratio < 0.08:
                raise FaceProcessingError("O rosto está muito distante")

            face_center_x = (float(face[0]) + face_width / 2.0) / width
            face_center_y = (float(face[1]) + face_height / 2.0) / height
            if abs(face_center_x - 0.5) > 0.28 or abs(face_center_y - 0.5) > 0.28:
                raise FaceProcessingError("Centralize o rosto dentro da marcação")

            aligned = self._recognizer.alignCrop(image, face)
            gray = cv.cvtColor(aligned, cv.COLOR_BGR2GRAY)
            gray_array = np.asarray(gray, dtype=np.uint8)
            brightness = float(np.mean(gray_array))
            if brightness < 45:
                raise FaceProcessingError("O ambiente está muito escuro")
            if brightness > 215:
                raise FaceProcessingError("Há luz excessiva sobre o rosto")

            contrast = float(np.std(gray_array))
            if contrast < 20:
                raise FaceProcessingError("A iluminação do rosto está sem contraste")

            blur_variance = float(cv.Laplacian(gray_array, cv.CV_64F).var())
            if blur_variance < 30:
                raise FaceProcessingError("A imagem está desfocada; mantenha o rosto parado")

            features = np.asarray(self._recognizer.feature(aligned), dtype=np.float32).reshape(-1)

            landmarks = face[4:14].reshape(5, 2)
            eye_center = np.mean(landmarks[0:2], axis=0)
            mouth_center = np.mean(landmarks[3:5], axis=0)
            eye_distance = max(float(np.linalg.norm(landmarks[0] - landmarks[1])), 1.0)
            vertical_span = max(float(mouth_center[1] - eye_center[1]), 1.0)
            yaw_offset = float((landmarks[2][0] - eye_center[0]) / eye_distance)
            pitch_ratio = float((landmarks[2][1] - eye_center[1]) / vertical_span)

        norm = float(np.linalg.norm(features))
        if not np.isfinite(norm) or norm <= 0:
            raise FaceProcessingError("Não foi possível gerar a biometria facial")
        embedding = np.asarray(features / norm, dtype=np.float32)
        brightness_quality = max(0.0, 1.0 - abs(brightness - 130.0) / 130.0)
        blur_quality = min(1.0, blur_variance / 180.0)
        contrast_quality = min(1.0, contrast / 55.0)
        size_quality = min(1.0, face_area_ratio / 0.18)
        quality = round(
            min(
                1.0,
                detection_score * 0.35
                + blur_quality * 0.25
                + brightness_quality * 0.15
                + contrast_quality * 0.15
                + size_quality * 0.1,
            ),
            4,
        )
        return FrameAnalysis(
            embedding=embedding,
            quality=quality,
            yaw_offset=round(yaw_offset, 4),
            pitch_ratio=round(pitch_ratio, 4),
            detection_score=round(detection_score, 4),
            sharpness=round(blur_variance, 2),
            brightness=round(brightness, 2),
            face_area_ratio=round(face_area_ratio, 4),
        )

    def analyze_frames(
        self,
        frames: list[bytes],
    ) -> tuple[list[FrameAnalysis], list[str]]:
        accepted: list[FrameAnalysis] = []
        rejected: list[str] = []
        for index, frame in enumerate(frames, start=1):
            try:
                accepted.append(self.analyze(frame))
            except FaceProcessingError as error:
                rejected.append(f"Frame {index}: {error}")
        return accepted, rejected

    @staticmethod
    def remove_outliers(analyses: list[FrameAnalysis]) -> list[FrameAnalysis]:
        if len(analyses) < 3:
            return analyses
        matrix = np.stack([analysis.embedding for analysis in analyses])
        centroid = np.mean(matrix, axis=0)
        centroid_norm = float(np.linalg.norm(centroid))
        if not np.isfinite(centroid_norm) or centroid_norm <= 0:
            return []
        centroid /= centroid_norm
        similarities = matrix @ centroid
        return [
            analysis
            for analysis, similarity in zip(analyses, similarities, strict=True)
            if float(similarity) >= 0.6
        ]


@lru_cache
def get_face_service() -> FaceService:
    return FaceService()

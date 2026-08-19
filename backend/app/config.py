from functools import lru_cache
from typing import Literal, Self

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="REGISTRO_",
        case_sensitive=False,
        extra="ignore",
    )

    environment: Literal["development", "test", "production"] = "development"
    database_url: str
    jwt_secret: SecretStr
    access_token_expire_minutes: int = 30
    cors_allowed_origins: list[str] = [
        "http://127.0.0.1:4173",
        "http://localhost:4173",
    ]
    database_echo: bool = False
    auth_required: bool = False
    demo_school_code: str = "DEMO"
    bootstrap_local_school: bool = True
    face_match_threshold: float = 0.45
    face_match_margin: float = 0.06
    face_duplicate_frame_threshold: float = 0.55
    face_duplicate_median_threshold: float = 0.60
    face_duplicate_required_ratio: float = 0.70

    @field_validator("jwt_secret")
    @classmethod
    def validate_jwt_secret(cls, value: SecretStr) -> SecretStr:
        if len(value.get_secret_value()) < 32:
            raise ValueError("REGISTRO_JWT_SECRET deve ter pelo menos 32 caracteres")
        return value

    @field_validator("access_token_expire_minutes")
    @classmethod
    def validate_token_duration(cls, value: int) -> int:
        if not 5 <= value <= 120:
            raise ValueError("A duração do token deve estar entre 5 e 120 minutos")
        return value

    @field_validator("face_match_threshold")
    @classmethod
    def validate_face_threshold(cls, value: float) -> float:
        if not 0.363 <= value <= 0.9:
            raise ValueError("O limiar facial deve ficar entre 0.363 e 0.9")
        return value

    @field_validator("face_match_margin")
    @classmethod
    def validate_face_margin(cls, value: float) -> float:
        if not 0 <= value <= 0.3:
            raise ValueError("A margem facial deve ficar entre 0 e 0.3")
        return value

    @field_validator("face_duplicate_frame_threshold", "face_duplicate_median_threshold")
    @classmethod
    def validate_duplicate_threshold(cls, value: float) -> float:
        if not 0.363 <= value <= 0.95:
            raise ValueError("O limiar de duplicidade facial deve ficar entre 0.363 e 0.95")
        return value

    @field_validator("face_duplicate_required_ratio")
    @classmethod
    def validate_duplicate_ratio(cls, value: float) -> float:
        if not 0.5 <= value <= 1:
            raise ValueError("A proporção facial mínima deve ficar entre 0.5 e 1")
        return value

    @model_validator(mode="after")
    def require_postgresql(self) -> Self:
        if not self.database_url.startswith("postgresql+psycopg://"):
            raise ValueError("REGISTRO_DATABASE_URL deve usar PostgreSQL com psycopg")
        if self.face_duplicate_median_threshold < self.face_duplicate_frame_threshold:
            raise ValueError(
                "REGISTRO_FACE_DUPLICATE_MEDIAN_THRESHOLD deve ser maior ou igual ao "
                "limiar por frame"
            )
        if self.environment == "production" and not self.auth_required:
            raise ValueError("REGISTRO_AUTH_REQUIRED deve ser true em produção")
        if self.environment == "production" and self.bootstrap_local_school:
            raise ValueError("REGISTRO_BOOTSTRAP_LOCAL_SCHOOL deve ser false em produção")
        return self


@lru_cache
def get_settings() -> Settings:
    # BaseSettings fills required values from the environment at runtime.
    return Settings()  # type: ignore[call-arg]

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import jwt
from pwdlib import PasswordHash

from app.config import Settings
from app.models import User

ALGORITHM = "HS256"
ISSUER = "registro-escolar-api"
AUDIENCE = "registro-escolar-web"
password_hash = PasswordHash.recommended()
DUMMY_PASSWORD_HASH = password_hash.hash("dummy-password-used-only-for-timing")


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return password_hash.verify(password, hashed_password)


def verify_unknown_password(password: str) -> None:
    password_hash.verify(password, DUMMY_PASSWORD_HASH)


def create_access_token(user: User, settings: Settings) -> tuple[str, int]:
    expires_in = settings.access_token_expire_minutes * 60
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": str(user.id),
        "sid": str(user.school_id),
        "role": user.role,
        "iss": ISSUER,
        "aud": AUDIENCE,
        "iat": now,
        "exp": now + timedelta(seconds=expires_in),
        "jti": str(uuid4()),
    }
    token = jwt.encode(payload, settings.jwt_secret.get_secret_value(), algorithm=ALGORITHM)
    return token, expires_in


def decode_access_token(token: str, settings: Settings) -> tuple[UUID, UUID]:
    payload = jwt.decode(
        token,
        settings.jwt_secret.get_secret_value(),
        algorithms=[ALGORITHM],
        audience=AUDIENCE,
        issuer=ISSUER,
    )
    return UUID(payload["sub"]), UUID(payload["sid"])

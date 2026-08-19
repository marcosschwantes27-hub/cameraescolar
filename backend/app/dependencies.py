from collections.abc import Callable
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.database import get_db
from app.enums import UserRole
from app.models import School, User
from app.security import decode_access_token

DbSession = Annotated[Session, Depends(get_db)]
AppSettings = Annotated[Settings, Depends(get_settings)]
bearer_scheme = HTTPBearer(auto_error=False)


def unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciais inválidas ou expiradas",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: DbSession,
    settings: AppSettings,
) -> User:
    if credentials is None and not settings.auth_required:
        demo_user = session.scalar(
            select(User)
            .join(School, School.id == User.school_id)
            .where(
                School.code == settings.demo_school_code.strip().upper(),
                School.is_active.is_(True),
                User.is_active.is_(True),
            )
            .order_by(User.created_at)
        )
        if demo_user is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Os dados de teste ainda não foram preparados",
            )
        return demo_user

    if credentials is None or credentials.scheme.casefold() != "bearer":
        raise unauthorized()

    try:
        user_id, school_id = decode_access_token(credentials.credentials, settings)
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        raise unauthorized() from None

    user = session.scalar(
        select(User).where(
            User.id == user_id,
            User.school_id == school_id,
            User.is_active.is_(True),
        )
    )
    if user is None:
        raise unauthorized()
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: UserRole) -> Callable[..., User]:
    allowed = {role.value for role in roles}

    def check_role(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Seu perfil não permite esta operação",
            )
        return user

    return check_role

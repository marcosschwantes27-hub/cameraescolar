from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.config import get_settings
from app.dependencies import CurrentUser, DbSession
from app.models import School, User
from app.schemas import LoginRequest, TokenResponse, UserRead
from app.security import create_access_token, verify_password, verify_unknown_password
from app.serializers import user_to_read

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, session: DbSession) -> TokenResponse:
    school_code = payload.school_code.strip().upper()
    email = payload.email.strip().casefold()
    user = session.scalar(
        select(User)
        .join(School, School.id == User.school_id)
        .where(
            School.code == school_code,
            School.is_active.is_(True),
            User.email == email,
            User.is_active.is_(True),
        )
    )

    if user is None:
        verify_unknown_password(payload.password)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Escola, e-mail ou senha inválidos",
        )
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Escola, e-mail ou senha inválidos",
        )

    token, expires_in = create_access_token(user, get_settings())
    return TokenResponse(access_token=token, expires_in=expires_in)


@router.get("/me", response_model=UserRead)
def me(user: CurrentUser) -> UserRead:
    return user_to_read(user)

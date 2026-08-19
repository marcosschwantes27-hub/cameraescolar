from fastapi import APIRouter, HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.dependencies import DbSession
from app.schemas import HealthRead

router = APIRouter(tags=["health"])


@router.get("/health/live", response_model=HealthRead)
def live() -> HealthRead:
    return HealthRead(status="ok")


@router.get("/health/ready", response_model=HealthRead)
def ready(session: DbSession) -> HealthRead:
    try:
        session.execute(text("SELECT 1"))
    except SQLAlchemyError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Banco de dados indisponível",
        ) from error
    return HealthRead(status="ok")

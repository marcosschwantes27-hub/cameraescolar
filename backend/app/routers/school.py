from fastapi import APIRouter
from sqlalchemy import select

from app.dependencies import CurrentUser, DbSession
from app.enums import Shift
from app.models import Classroom
from app.schemas import ClassroomRead

router = APIRouter(prefix="/api/v1/classrooms", tags=["classrooms"])


@router.get("", response_model=list[ClassroomRead])
def list_classrooms(session: DbSession, user: CurrentUser) -> list[ClassroomRead]:
    classrooms = session.scalars(
        select(Classroom)
        .where(Classroom.school_id == user.school_id, Classroom.is_active.is_(True))
        .order_by(Classroom.name)
    ).all()
    return [
        ClassroomRead(
            id=classroom.id,
            name=classroom.name,
            academic_year=classroom.academic_year,
            shift=Shift(classroom.shift),
        )
        for classroom in classrooms
    ]

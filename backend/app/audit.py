from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import AuditLog, User


def append_audit_log(
    session: Session,
    *,
    actor: User,
    action: str,
    entity_type: str,
    entity_id: UUID,
    details: dict[str, Any] | None = None,
) -> None:
    session.add(
        AuditLog(
            school_id=actor.school_id,
            actor_user_id=actor.id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            details=details or {},
        )
    )

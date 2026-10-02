import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock import AuditLog
from app.models.user import User


async def record(
    db: AsyncSession, user: User | None, entity_type: str, entity_id: uuid.UUID, entity_code: str | None,
    action: str, *, from_status: str | None = None, to_status: str | None = None, reason: str | None = None,
    changes: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            entity_type=entity_type, entity_id=entity_id, entity_code=entity_code, action=action,
            from_status=from_status, to_status=to_status, user_id=user.id if user else None,
            user_name=user.name if user else None, reason=reason, changes=changes,
        )
    )


async def history(db: AsyncSession, entity_type: str, entity_id: uuid.UUID) -> list[AuditLog]:
    result = await db.execute(
        select(AuditLog)
        .where(AuditLog.entity_type == entity_type, AuditLog.entity_id == entity_id)
        .order_by(AuditLog.created_at, AuditLog.id)
    )
    return list(result.scalars().all())

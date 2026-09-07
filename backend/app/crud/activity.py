from sqlalchemy.ext.asyncio import AsyncSession

from app.models.governance import ActivityLog
from app.models.user import Role, User


async def log_activity(db: AsyncSession, user: User, action: str, detail: str = "") -> None:
    role_label = user.user_type.capitalize()
    if user.role_id:
        role = await db.get(Role, user.role_id)
        if role:
            role_label = role.label
    db.add(
        ActivityLog(
            actor_id=user.id,
            actor_name=user.name,
            role_label=role_label,
            action=action,
            detail=detail,
        )
    )

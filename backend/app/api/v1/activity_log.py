from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.governance import ActivityLog
from app.models.user import User

router = APIRouter(prefix="/activity-log", tags=["governance"])


@router.get("")
async def list_activity(
    limit: int = 100, db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)
):
    result = await db.execute(select(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(limit))
    rows = result.scalars().all()
    return [
        {
            "id": r.id,
            "actor": r.actor_name,
            "role": r.role_label,
            "action": r.action,
            "detail": r.detail,
            "at": r.created_at.isoformat(),
        }
        for r in rows
    ]

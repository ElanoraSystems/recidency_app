"""One endpoint for every workflow step of every transaction type
(meal_log, stock_transfer, waste_log, grn, ...), plus its audit history."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import _user_allowed_modules, get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services import audit, workflow

router = APIRouter(prefix="/transactions", tags=["transactions"])


class ActionIn(BaseModel):
    reason: str | None = None


class ActionOut(BaseModel):
    id: uuid.UUID
    code: str | None
    status: str


class HistoryOut(BaseModel):
    id: uuid.UUID
    action: str
    from_status: str | None
    to_status: str | None
    user_name: str | None
    reason: str | None
    changes: dict | None
    created_at: datetime


async def _authorize(db: AsyncSession, user: User, module: str) -> None:
    if user.user_type == "owner":
        return
    if module not in await _user_allowed_modules(user, db):
        raise HTTPException(403, f"No access to module '{module}'")


@router.post("/{entity_type}/{entity_id}/{action}", response_model=ActionOut)
async def run_action(
    entity_type: str,
    entity_id: uuid.UUID,
    action: str,
    payload: ActionIn | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    doctype = workflow.get_doctype(entity_type)
    await _authorize(db, user, doctype.module)
    obj = await db.get(doctype.model, entity_id)
    if not obj:
        raise HTTPException(404, f"{doctype.label} not found")
    status = await workflow.apply_action(db, doctype, obj, action, user, payload.reason if payload else None)
    await db.commit()
    return ActionOut(id=obj.id, code=getattr(obj, "code", None), status=status)


@router.get("/{entity_type}/{entity_id}/history", response_model=list[HistoryOut])
async def history(
    entity_type: str,
    entity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    doctype = workflow.get_doctype(entity_type)
    await _authorize(db, user, doctype.module)
    rows = await audit.history(db, entity_type, entity_id)
    return [
        HistoryOut(
            id=r.id, action=r.action, from_status=r.from_status, to_status=r.to_status, user_name=r.user_name,
            reason=r.reason, changes=r.changes, created_at=r.created_at,
        )
        for r in rows
    ]

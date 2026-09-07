import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_module
from app.crud.activity import log_activity
from app.db.session import get_db
from app.models.facilities import Asset, MaintenanceRequest, PmSchedule
from app.models.user import User

router = APIRouter(prefix="/maintenance-requests", tags=["maintenance"])
pm_router = APIRouter(prefix="/pm-schedule", tags=["maintenance"])
maintenance_access = require_module("maintenance")


class MaintenanceRequestIn(BaseModel):
    issue: str
    location_id: uuid.UUID | None = None
    asset_id: uuid.UUID | None = None
    description: str | None = None
    priority: str = "Medium"
    reported_date: date


class MaintenanceRequestOut(BaseModel):
    id: uuid.UUID
    issue: str
    location_id: uuid.UUID | None
    asset_id: uuid.UUID | None
    description: str | None
    priority: str
    reported_by: uuid.UUID | None
    reported_date: date
    status: str
    assignee_id: uuid.UUID | None
    verified: bool

    class Config:
        from_attributes = True


@router.post("", response_model=MaintenanceRequestOut, status_code=201)
async def create_request(
    payload: MaintenanceRequestIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(maintenance_access),
):
    """Hand-written (rather than the generic CRUD router) so `reported_by`
    is always the authenticated user — needed to route the post-repair
    confirmation back to whoever actually filed the request."""
    req = MaintenanceRequest(
        issue=payload.issue,
        location_id=payload.location_id,
        asset_id=payload.asset_id,
        description=payload.description,
        priority=payload.priority,
        reported_by=user.id,
        reported_date=payload.reported_date,
        status="Reported",
    )
    db.add(req)
    await log_activity(db, user, "Reported maintenance issue", req.issue)
    await db.commit()
    await db.refresh(req)
    return req


class StatusIn(BaseModel):
    status: str


@router.post("/{request_id}/status")
async def advance_status(
    request_id: uuid.UUID,
    payload: StatusIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(maintenance_access),
):
    """Hand-written so the status trail actually lands in the Activity Log —
    the generic PATCH this used to go through has no notion of business
    events, so a request could go Reported -> ... -> Closed with zero
    audit trail beyond the bare status column."""
    req = await db.get(MaintenanceRequest, request_id)
    if not req:
        raise HTTPException(404, "Maintenance request not found")
    if payload.status == "Verified":
        raise HTTPException(
            400,
            "Repaired requests are verified through the requester's confirmation "
            "in Approvals, not set directly.",
        )
    from_status = req.status
    req.status = payload.status
    req.verified = False
    await log_activity(db, user, f"{from_status} → {payload.status}", req.issue)
    await db.commit()
    await db.refresh(req)
    return {"id": req.id, "status": req.status, "verified": req.verified}


class AssignIn(BaseModel):
    assignee_id: uuid.UUID


@router.post("/{request_id}/assign")
async def assign_technician(
    request_id: uuid.UUID,
    payload: AssignIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(maintenance_access),
):
    req = await db.get(MaintenanceRequest, request_id)
    if not req:
        raise HTTPException(404, "Maintenance request not found")
    req.assignee_id = payload.assignee_id
    req.status = "Assigned"
    await log_activity(db, user, "Assigned maintenance request", req.issue)
    await db.commit()
    await db.refresh(req)
    return {"id": req.id, "status": req.status, "assignee_id": req.assignee_id}


@pm_router.post("/{pm_id}/log-service")
async def log_service(
    pm_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(maintenance_access)
):
    pm = await db.get(PmSchedule, pm_id)
    if not pm:
        raise HTTPException(404, "PM schedule item not found")
    asset = await db.get(Asset, pm.asset_id)
    if not asset:
        raise HTTPException(404, "Linked asset not found")

    days = 90 if pm.frequency == "Quarterly" else 182 if pm.frequency == "Bi-annual" else 30
    next_due = date.today() + timedelta(days=days)
    pm.due_date = next_due
    asset.last_service = date.today()
    asset.next_service = next_due

    await log_activity(db, user, "Logged service", f"{asset.name} — {pm.task}")
    await db.commit()
    return {"id": pm.id, "due_date": pm.due_date, "asset_last_service": asset.last_service, "asset_next_service": asset.next_service}

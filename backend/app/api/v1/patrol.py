import io
import uuid
from datetime import date, datetime

import qrcode
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_module
from app.core.config import get_settings
from app.crud.activity import log_activity
from app.db.session import get_db
from app.models.facilities import Area
from app.models.people import StaffProfile
from app.models.security import PatrolLog
from app.models.user import User

router = APIRouter(prefix="/patrol", tags=["patrol"])
patrol_access = require_module("patrol")
# Printing an area's QR code is a Residence Setup action (Settings ->
# Residence Setup, where Areas themselves live) — the Owner/Manager set
# these up, not the guard who scans them.
areas_access = require_module("housekeeping")


@router.get("/areas/{area_id}/qr-code")
async def area_qr_code(
    area_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(areas_access)
):
    area = await db.get(Area, area_id)
    if not area:
        raise HTTPException(404, "Area not found")
    url = f"{get_settings().app_base_url}/patrol/scan?area={area_id}"
    img = qrcode.make(url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(
        content=buf.getvalue(), media_type="image/png",
        headers={"Content-Disposition": f'inline; filename="patrol-qr-{area.name}.png"'},
    )


class ScanIn(BaseModel):
    area_id: uuid.UUID
    notes: str | None = None


class ScanOut(BaseModel):
    id: uuid.UUID
    area_id: uuid.UUID | None
    area_name: str | None
    scanned_at: datetime

    class Config:
        from_attributes = True


@router.post("/scan", response_model=ScanOut, status_code=201)
async def scan_area(
    payload: ScanIn, db: AsyncSession = Depends(get_db), user: User = Depends(patrol_access)
):
    area = await db.get(Area, payload.area_id)
    if not area:
        raise HTTPException(404, "Area not found")
    staff = (
        await db.execute(select(StaffProfile).where(StaffProfile.user_id == user.id))
    ).scalar_one_or_none()
    log = PatrolLog(area_id=area.id, staff_id=staff.id if staff else None, notes=payload.notes)
    db.add(log)
    await log_activity(db, user, "Patrol check-in", area.name)
    await db.commit()
    await db.refresh(log)
    return ScanOut(id=log.id, area_id=log.area_id, area_name=area.name, scanned_at=log.scanned_at)


class PatrolLogOut(BaseModel):
    id: uuid.UUID
    area_id: uuid.UUID | None
    area_name: str | None
    staff_id: uuid.UUID | None
    staff_name: str | None
    scanned_at: datetime
    notes: str | None


@router.get("", response_model=list[PatrolLogOut])
async def list_patrol_log(
    area_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(patrol_access),
):
    stmt = select(PatrolLog).order_by(PatrolLog.scanned_at.desc())
    if area_id:
        stmt = stmt.where(PatrolLog.area_id == area_id)
    if date_from:
        stmt = stmt.where(PatrolLog.scanned_at >= date_from)
    if date_to:
        stmt = stmt.where(PatrolLog.scanned_at < date_to)
    logs = (await db.execute(stmt)).scalars().all()

    out = []
    for log in logs:
        area = await db.get(Area, log.area_id) if log.area_id else None
        staff_name = None
        if log.staff_id:
            staff = await db.get(StaffProfile, log.staff_id)
            if staff:
                staff_user = await db.get(User, staff.user_id)
                staff_name = staff_user.name if staff_user else None
        out.append(
            PatrolLogOut(
                id=log.id, area_id=log.area_id, area_name=area.name if area else None,
                staff_id=log.staff_id, staff_name=staff_name, scanned_at=log.scanned_at, notes=log.notes,
            )
        )
    return out

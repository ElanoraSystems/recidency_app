import uuid
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_module
from app.crud.activity import log_activity
from app.db.session import get_db
from app.models.facilities import Asset, Attachment
from app.models.user import User

router = APIRouter(prefix="/assets", tags=["maintenance"])
maintenance_access = require_module("maintenance")

UPLOAD_ROOT = Path(__file__).resolve().parents[3] / "uploads"


class AssetIn(BaseModel):
    name: str
    category: str
    brand: str | None = None
    model: str | None = None
    serial: str | None = None
    location_id: uuid.UUID | None = None
    install_date: date | None = None
    warranty_end: date | None = None
    provider: str | None = None
    supplier_id: uuid.UUID | None = None
    purchase_cost: float | None = None
    assigned_to: uuid.UUID | None = None
    status: str = "Active"


class AssetUpdate(BaseModel):
    name: str | None = None
    category: str | None = None
    brand: str | None = None
    model: str | None = None
    serial: str | None = None
    location_id: uuid.UUID | None = None
    install_date: date | None = None
    warranty_end: date | None = None
    provider: str | None = None
    supplier_id: uuid.UUID | None = None
    purchase_cost: float | None = None
    assigned_to: uuid.UUID | None = None
    status: str | None = None
    last_service: date | None = None
    next_service: date | None = None


class AssetOut(AssetIn):
    id: uuid.UUID
    status: str
    approval_status: str
    last_service: date | None = None
    next_service: date | None = None

    class Config:
        from_attributes = True


@router.get("", response_model=list[AssetOut])
async def list_assets(db: AsyncSession = Depends(get_db), _user: User = Depends(maintenance_access)):
    result = await db.execute(select(Asset).order_by(Asset.name))
    return result.scalars().all()


@router.post("", response_model=AssetOut, status_code=201)
async def create_asset(
    payload: AssetIn, db: AsyncSession = Depends(get_db), user: User = Depends(maintenance_access)
):
    """A non-manager's new asset sits Pending until an Owner/Manager approves
    it (build plan §07, phase 3 'done' criteria) — the approval gate the
    prototype never enforced server-side."""
    asset = Asset(
        **payload.model_dump(),
        approval_status="Approved" if user.user_type == "owner" else "Pending",
        created_by=user.id,
    )
    db.add(asset)
    await log_activity(db, user, "Added asset", f"{payload.name} ({asset.approval_status})")
    await db.commit()
    await db.refresh(asset)
    return asset


@router.post("/{asset_id}/decision", response_model=AssetOut)
async def decide_asset(
    asset_id: uuid.UUID,
    approve: bool,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(maintenance_access),
):
    if user.user_type not in ("owner",):
        raise HTTPException(403, "Only the Owner can approve assets")
    asset = await db.get(Asset, asset_id)
    if not asset:
        raise HTTPException(404, "Asset not found")
    asset.approval_status = "Approved" if approve else "Rejected"
    await log_activity(db, user, f"{asset.approval_status} asset", asset.name)
    await db.commit()
    await db.refresh(asset)
    return asset


@router.patch("/{asset_id}", response_model=AssetOut)
async def update_asset(
    asset_id: uuid.UUID,
    payload: AssetUpdate,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(maintenance_access),
):
    asset = await db.get(Asset, asset_id)
    if not asset:
        raise HTTPException(404, "Asset not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(asset, key, value)
    await db.commit()
    await db.refresh(asset)
    return asset


@router.delete("/{asset_id}", status_code=204)
async def delete_asset(
    asset_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(maintenance_access)
):
    asset = await db.get(Asset, asset_id)
    if not asset:
        raise HTTPException(404, "Asset not found")
    await db.delete(asset)
    await db.commit()

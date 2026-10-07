import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.security import hash_password
from app.crud.activity import log_activity
from app.db.session import get_db
from app.models.finance import ResidenceSettings
from app.models.user import FamilyAccount, FamilyModuleAccess, User
from app.services.files import file_response, read_upload

router = APIRouter(prefix="/settings", tags=["settings"])


def require_owner(user: User = Depends(get_current_user)) -> User:
    if user.user_type != "owner":
        raise HTTPException(403, "Owner only")
    return user


class ResidenceIn(BaseModel):
    name: str
    location: str | None = None
    currency: str = "KWD"
    timezone: str = "Asia/Kuwait"
    monthly_budget: float = 0
    address: str | None = None
    phone: str | None = None
    terms_and_conditions: str | None = None


@router.get("/residence")
async def get_residence(db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    result = await db.execute(select(ResidenceSettings).limit(1))
    residence = result.scalar_one_or_none()
    if not residence:
        raise HTTPException(404, "Residence settings not configured")
    return {
        "id": residence.id,
        "name": residence.name,
        "location": residence.location,
        "currency": residence.currency,
        "timezone": residence.timezone,
        "monthly_budget": float(residence.monthly_budget),
        "logo_path": residence.logo_path,
        "address": residence.address,
        "phone": residence.phone,
        "terms_and_conditions": residence.terms_and_conditions,
    }


@router.put("/residence")
async def update_residence(
    payload: ResidenceIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_owner)
):
    result = await db.execute(select(ResidenceSettings).limit(1))
    residence = result.scalar_one_or_none()
    if not residence:
        residence = ResidenceSettings(**payload.model_dump())
        db.add(residence)
    else:
        for key, value in payload.model_dump().items():
            setattr(residence, key, value)
    await log_activity(db, user, "Updated residence settings", payload.name)
    await db.commit()
    return {"ok": True}


@router.post("/residence/logo", status_code=201)
async def upload_residence_logo(
    file: UploadFile, db: AsyncSession = Depends(get_db), user: User = Depends(require_owner)
):
    result = await db.execute(select(ResidenceSettings).limit(1))
    residence = result.scalar_one_or_none()
    if not residence:
        raise HTTPException(404, "Residence settings not configured")
    kind = (file.content_type or "").lower()
    if not kind.startswith("image/"):
        raise HTTPException(400, "The logo must be an image")
    key = f"db/logo/{uuid.uuid4()}-{file.filename}"
    residence.logo_data = await read_upload(file)
    residence.logo_content_type = kind
    residence.logo_path = key
    await log_activity(db, user, "Updated residence logo", file.filename or "")
    await db.commit()
    return {"logo_path": key}


@router.get("/residence/logo")
async def download_residence_logo(db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    result = await db.execute(select(ResidenceSettings).limit(1))
    residence = result.scalar_one_or_none()
    if not residence or not residence.logo_path:
        raise HTTPException(404, "No logo uploaded")
    return file_response(residence.logo_data, residence.logo_path, "logo", residence.logo_content_type, attachment=False)


class FamilyAccountIn(BaseModel):
    name: str
    email: str
    relation: str
    family_member_id: uuid.UUID | None = None
    modules: list[str] = []


@router.get("/family-accounts")
async def list_family_accounts(
    db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)
):
    result = await db.execute(select(FamilyAccount))
    accounts = result.scalars().all()
    out = []
    for account in accounts:
        user = await db.get(User, account.user_id)
        modules = (
            await db.execute(
                select(FamilyModuleAccess.module).where(
                    FamilyModuleAccess.family_account_id == account.id
                )
            )
        ).scalars().all()
        out.append(
            {
                "id": account.id,
                "name": user.name if user else None,
                "email": user.email if user else None,
                "relation": account.relation,
                "active": account.active,
                "modules": modules,
            }
        )
    return out


@router.post("/family-accounts", status_code=201)
async def create_family_account(
    payload: FamilyAccountIn, db: AsyncSession = Depends(get_db), owner: User = Depends(require_owner)
):
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "A user with this email already exists")

    temp_password = uuid.uuid4().hex[:10]
    user = User(
        user_type="family",
        name=payload.name,
        email=payload.email,
        password_hash=hash_password(temp_password),
        must_change_password=True,
    )
    db.add(user)
    await db.flush()

    account = FamilyAccount(
        user_id=user.id, family_member_id=payload.family_member_id, relation=payload.relation
    )
    db.add(account)
    await db.flush()
    for module in payload.modules:
        db.add(FamilyModuleAccess(family_account_id=account.id, module=module))

    await log_activity(db, owner, "Created family login", f"{payload.relation} — {len(payload.modules)} modules")
    await db.commit()
    return {"id": account.id, "temporary_password": temp_password}


@router.put("/family-accounts/{account_id}/modules")
async def set_family_modules(
    account_id: uuid.UUID,
    modules: list[str],
    db: AsyncSession = Depends(get_db),
    owner: User = Depends(require_owner),
):
    account = await db.get(FamilyAccount, account_id)
    if not account:
        raise HTTPException(404, "Family account not found")
    result = await db.execute(
        select(FamilyModuleAccess).where(FamilyModuleAccess.family_account_id == account_id)
    )
    for existing in result.scalars().all():
        await db.delete(existing)
    await db.flush()
    for module in modules:
        db.add(FamilyModuleAccess(family_account_id=account_id, module=module))
    await log_activity(db, owner, "Updated family module access", str(len(modules)))
    await db.commit()
    return {"ok": True}


@router.patch("/family-accounts/{account_id}/active")
async def toggle_family_account(
    account_id: uuid.UUID,
    active: bool,
    db: AsyncSession = Depends(get_db),
    owner: User = Depends(require_owner),
):
    account = await db.get(FamilyAccount, account_id)
    if not account:
        raise HTTPException(404, "Family account not found")
    account.active = active
    await db.commit()
    return {"ok": True}


class FamilyAccountDetailsIn(BaseModel):
    name: str
    email: str
    relation: str


@router.patch("/family-accounts/{account_id}")
async def update_family_account(
    account_id: uuid.UUID,
    payload: FamilyAccountDetailsIn,
    db: AsyncSession = Depends(get_db),
    owner: User = Depends(require_owner),
):
    account = await db.get(FamilyAccount, account_id)
    if not account:
        raise HTTPException(404, "Family account not found")
    user = await db.get(User, account.user_id)
    if not user:
        raise HTTPException(404, "Linked user not found")
    existing = await db.execute(select(User).where(User.email == payload.email, User.id != user.id))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "A user with this email already exists")
    user.name = payload.name
    user.email = payload.email
    account.relation = payload.relation
    await log_activity(db, owner, "Updated family login details", payload.name)
    await db.commit()
    return {"ok": True}


@router.delete("/family-accounts/{account_id}", status_code=204)
async def delete_family_account(
    account_id: uuid.UUID, db: AsyncSession = Depends(get_db), owner: User = Depends(require_owner)
):
    """Deletes the underlying user too — a family account is nothing but a
    login, so removing it should fully revoke access, not leave a dangling
    users row with no module access."""
    account = await db.get(FamilyAccount, account_id)
    if not account:
        raise HTTPException(404, "Family account not found")
    user = await db.get(User, account.user_id)
    await log_activity(db, owner, "Removed family login", account.relation)
    if user:
        await db.delete(user)
    else:
        await db.delete(account)
    await db.commit()


NOTIF_CATEGORIES = [
    "Low inventory", "Expiring food", "Expiring documents", "Pending approvals", "Overdue tasks",
    "Maintenance due", "Vehicle service due", "Staff absence", "Upcoming guest", "Upcoming event", "Budget exceeded",
    "Area not patrolled today",
]


@router.get("/notification-prefs")
async def get_notification_prefs(user: User = Depends(get_current_user)):
    """Per-user, server-side (missing categories default to enabled, so a
    category added after a user's prefs were saved still starts 'on')."""
    stored = user.notification_prefs or {}
    return {cat: stored.get(cat, True) for cat in NOTIF_CATEGORIES}


@router.put("/notification-prefs")
async def set_notification_prefs(
    prefs: dict[str, bool], db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    user.notification_prefs = {**(user.notification_prefs or {}), **prefs}
    await db.commit()
    return {"ok": True}

import re
import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_module
from app.core.security import hash_password
from app.crud.activity import log_activity
from app.db.session import get_db
from app.models.people import Attendance, LeaveRequest, StaffProfile
from app.models.user import Role, User

router = APIRouter(prefix="/people", tags=["people"])
people_access = require_module("people")


async def _my_staff_profile(db: AsyncSession, user: User) -> StaffProfile:
    """Self-service actions (check-in, leave requests) are scoped to the
    caller's own record, gated by being a logged-in staff account — not by
    People module access, since most staff roles don't have that."""
    if user.user_type != "staff":
        raise HTTPException(400, "Only staff accounts have attendance or leave records")
    profile = (await db.execute(select(StaffProfile).where(StaffProfile.user_id == user.id))).scalar_one_or_none()
    if not profile:
        raise HTTPException(404, "No staff profile found for your account")
    return profile


class AttendanceOut(BaseModel):
    id: uuid.UUID
    date: date
    check_in: str | None
    check_out: str | None
    status: str

    class Config:
        from_attributes = True


@router.get("/attendance/mine", response_model=list[AttendanceOut])
async def my_attendance(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    profile = await _my_staff_profile(db, user)
    result = await db.execute(
        select(Attendance).where(Attendance.staff_id == profile.id).order_by(Attendance.date.desc())
    )
    return [
        AttendanceOut(
            id=a.id, date=a.date,
            check_in=a.check_in.strftime("%H:%M") if a.check_in else None,
            check_out=a.check_out.strftime("%H:%M") if a.check_out else None,
            status=a.status,
        )
        for a in result.scalars().all()
    ]


@router.post("/attendance/checkin", response_model=AttendanceOut)
async def check_in(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    profile = await _my_staff_profile(db, user)
    today = date.today()
    now = datetime.now().time().replace(second=0, microsecond=0)
    existing = (
        await db.execute(select(Attendance).where(Attendance.staff_id == profile.id, Attendance.date == today))
    ).scalar_one_or_none()
    if existing:
        existing.check_in = now
        existing.check_out = None
        existing.status = "Present"
        record = existing
    else:
        record = Attendance(staff_id=profile.id, date=today, check_in=now, status="Present")
        db.add(record)
    await db.commit()
    await db.refresh(record)
    return AttendanceOut(
        id=record.id, date=record.date, check_in=record.check_in.strftime("%H:%M"),
        check_out=None, status=record.status,
    )


@router.post("/attendance/checkout", response_model=AttendanceOut)
async def check_out(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    profile = await _my_staff_profile(db, user)
    today = date.today()
    record = (
        await db.execute(select(Attendance).where(Attendance.staff_id == profile.id, Attendance.date == today))
    ).scalar_one_or_none()
    if not record or record.status != "Present":
        raise HTTPException(400, "You haven't checked in today")
    record.check_out = datetime.now().time().replace(second=0, microsecond=0)
    await db.commit()
    await db.refresh(record)
    return AttendanceOut(
        id=record.id, date=record.date,
        check_in=record.check_in.strftime("%H:%M") if record.check_in else None,
        check_out=record.check_out.strftime("%H:%M"), status=record.status,
    )


class MyLeaveRequestIn(BaseModel):
    type: str
    from_date: date
    to_date: date
    reason: str | None = None


class LeaveRequestOut(BaseModel):
    id: uuid.UUID
    type: str
    from_date: date
    to_date: date
    days: int
    status: str
    reason: str | None
    requested_on: date

    class Config:
        from_attributes = True


@router.get("/leave-requests/mine", response_model=list[LeaveRequestOut])
async def my_leave_requests(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    profile = await _my_staff_profile(db, user)
    result = await db.execute(
        select(LeaveRequest).where(LeaveRequest.staff_id == profile.id).order_by(LeaveRequest.requested_on.desc())
    )
    return result.scalars().all()


@router.post("/leave-requests/mine", response_model=LeaveRequestOut, status_code=201)
async def request_leave(
    payload: MyLeaveRequestIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    profile = await _my_staff_profile(db, user)
    if payload.to_date < payload.from_date:
        raise HTTPException(400, "End date must be on or after the start date")
    days = (payload.to_date - payload.from_date).days + 1
    leave = LeaveRequest(
        staff_id=profile.id, type=payload.type, from_date=payload.from_date, to_date=payload.to_date,
        days=days, status="Pending", reason=payload.reason, requested_on=date.today(),
    )
    db.add(leave)
    await log_activity(db, user, "Requested leave", f"{payload.type} — {days} day(s)")
    await db.commit()
    await db.refresh(leave)
    return leave


class StaffIn(BaseModel):
    name: str
    email: str
    phone: str | None = None
    position: str
    department: str
    role_key: str
    supervisor_id: uuid.UUID | None = None
    join_date: date | None = None
    id_type: str | None = None
    id_number: str | None = None
    id_expiry: date | None = None
    contract_type: str | None = None
    contract_end: date | None = None
    salary: float | None = None
    salary_currency: str = "KWD"
    emergency_contact: dict = {}
    responsibilities: list[str] = []
    uniform: list[str] = []
    notes: str | None = None
    off_site_role: bool = False


class StaffOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    email: str | None
    phone: str | None
    position: str
    department: str
    role_key: str | None
    supervisor_id: uuid.UUID | None
    status: str
    join_date: date | None
    id_type: str | None
    id_number: str | None
    id_expiry: date | None
    contract_type: str | None
    contract_end: date | None
    salary: float | None
    salary_currency: str
    emergency_contact: dict
    responsibilities: list
    uniform: list
    notes: str | None
    off_site_role: bool


async def _staff_out(db: AsyncSession, profile: StaffProfile, user: User) -> StaffOut:
    role_key = None
    if user.role_id:
        role = await db.get(Role, user.role_id)
        role_key = role.key if role else None
    return StaffOut(
        id=profile.id,
        user_id=user.id,
        name=user.name,
        email=user.email,
        phone=user.phone,
        position=profile.position,
        department=profile.department,
        role_key=role_key,
        supervisor_id=profile.supervisor_id,
        status=profile.status,
        join_date=profile.join_date,
        id_type=profile.id_type,
        id_number=profile.id_number,
        id_expiry=profile.id_expiry,
        contract_type=profile.contract_type,
        contract_end=profile.contract_end,
        salary=float(profile.salary) if profile.salary is not None else None,
        salary_currency=profile.salary_currency,
        emergency_contact=profile.emergency_contact or {},
        responsibilities=profile.responsibilities or [],
        uniform=profile.uniform or [],
        notes=profile.notes,
        off_site_role=profile.off_site_role,
    )


@router.get("/staff", response_model=list[StaffOut])
async def list_staff(db: AsyncSession = Depends(get_db), _user: User = Depends(people_access)):
    result = await db.execute(select(StaffProfile))
    profiles = result.scalars().all()
    out = []
    for profile in profiles:
        user = await db.get(User, profile.user_id)
        if user:
            out.append(await _staff_out(db, profile, user))
    return out


@router.post("/staff", response_model=StaffOut, status_code=201)
async def create_staff(
    payload: StaffIn, db: AsyncSession = Depends(get_db), actor: User = Depends(people_access)
):
    result = await db.execute(select(Role).where(Role.key == payload.role_key))
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(400, f"Unknown role '{payload.role_key}'")

    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "A user with this email already exists")

    user = User(
        user_type="staff",
        name=payload.name,
        email=payload.email,
        phone=payload.phone,
        password_hash=hash_password(uuid.uuid4().hex),
        must_change_password=True,
        role_id=role.id,
    )
    db.add(user)
    await db.flush()

    profile = StaffProfile(
        user_id=user.id,
        position=payload.position,
        department=payload.department,
        supervisor_id=payload.supervisor_id,
        join_date=payload.join_date,
        id_type=payload.id_type,
        id_number=payload.id_number,
        id_expiry=payload.id_expiry,
        contract_type=payload.contract_type,
        contract_end=payload.contract_end,
        salary=payload.salary,
        salary_currency=payload.salary_currency,
        emergency_contact=payload.emergency_contact,
        responsibilities=payload.responsibilities,
        uniform=payload.uniform,
        notes=payload.notes,
        off_site_role=payload.off_site_role,
    )
    db.add(profile)
    await log_activity(db, actor, "Added staff member", f"{payload.name} — {payload.position}")
    await db.commit()
    await db.refresh(profile)
    return await _staff_out(db, profile, user)


@router.patch("/staff/{staff_id}", response_model=StaffOut)
async def update_staff(
    staff_id: uuid.UUID,
    payload: StaffIn,
    db: AsyncSession = Depends(get_db),
    _actor: User = Depends(people_access),
):
    profile = await db.get(StaffProfile, staff_id)
    if not profile:
        raise HTTPException(404, "Staff member not found")
    user = await db.get(User, profile.user_id)
    if not user:
        raise HTTPException(404, "Linked user not found")

    result = await db.execute(select(Role).where(Role.key == payload.role_key))
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(400, f"Unknown role '{payload.role_key}'")
    if payload.supervisor_id == staff_id:
        raise HTTPException(400, "A staff member cannot be their own supervisor")

    user.name = payload.name
    user.email = payload.email
    user.phone = payload.phone
    user.role_id = role.id

    for field in (
        "position", "department", "supervisor_id", "join_date", "id_type", "id_number", "id_expiry",
        "contract_type", "contract_end", "salary", "salary_currency", "emergency_contact",
        "responsibilities", "uniform", "notes", "off_site_role",
    ):
        setattr(profile, field, getattr(payload, field))

    await db.commit()
    await db.refresh(profile)
    return await _staff_out(db, profile, user)


@router.get("/roles")
async def list_roles(db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    from app.models.user import RoleModuleAccess

    result = await db.execute(select(Role))
    roles = result.scalars().all()
    out = []
    for role in roles:
        modules_result = await db.execute(
            select(RoleModuleAccess.module).where(RoleModuleAccess.role_id == role.id)
        )
        out.append({"id": role.id, "key": role.key, "label": role.label, "modules": modules_result.scalars().all()})
    return out


class RoleIn(BaseModel):
    label: str


def _slugify_role_key(label: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")
    return slug or "role"


@router.post("/roles", status_code=201)
async def create_role(
    payload: RoleIn, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)
):
    if actor.user_type != "owner":
        raise HTTPException(403, "Only the Owner can create roles")
    label = payload.label.strip()
    if not label:
        raise HTTPException(400, "Role name is required")
    key = _slugify_role_key(label)
    existing = await db.execute(select(Role).where(Role.key == key))
    if existing.scalar_one_or_none():
        raise HTTPException(409, f"A role with a similar name already exists")
    role = Role(key=key, label=label)
    db.add(role)
    await log_activity(db, actor, "Created role", label)
    await db.commit()
    await db.refresh(role)
    return {"id": role.id, "key": role.key, "label": role.label, "modules": []}


@router.delete("/roles/{role_id}", status_code=204)
async def delete_role(
    role_id: uuid.UUID, db: AsyncSession = Depends(get_db), actor: User = Depends(get_current_user)
):
    if actor.user_type != "owner":
        raise HTTPException(403, "Only the Owner can delete roles")
    role = await db.get(Role, role_id)
    if not role:
        raise HTTPException(404, "Role not found")
    if role.key == "owner":
        raise HTTPException(400, "The Owner role can't be deleted")
    in_use = (await db.execute(select(User).where(User.role_id == role_id))).scalars().first()
    if in_use:
        raise HTTPException(400, f"Can't delete '{role.label}' — it's still assigned to at least one user")
    await log_activity(db, actor, "Deleted role", role.label)
    await db.delete(role)
    await db.commit()


@router.put("/roles/{role_id}/modules")
async def set_role_modules(
    role_id: uuid.UUID,
    modules: list[str],
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    if actor.user_type != "owner":
        raise HTTPException(403, "Only the Owner can edit role access")
    from app.models.user import RoleModuleAccess

    role = await db.get(Role, role_id)
    if not role:
        raise HTTPException(404, "Role not found")
    result = await db.execute(select(RoleModuleAccess).where(RoleModuleAccess.role_id == role_id))
    for existing in result.scalars().all():
        await db.delete(existing)
    await db.flush()
    for module in modules:
        db.add(RoleModuleAccess(role_id=role_id, module=module))
    await log_activity(db, actor, "Updated role access", f"{role.label} — {len(modules)} modules")
    await db.commit()
    return {"ok": True}

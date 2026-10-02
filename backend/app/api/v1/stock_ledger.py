"""Read side of the stock engine: cost-center-wise balances, the movement
ledger, and a consistency check."""

import uuid
from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import _user_allowed_modules, get_current_user
from app.db.session import get_db
from app.models.kitchen import CostCenter, FoodInventory
from app.models.purchasing import Inventory
from app.models.stock import StockMovement
from app.models.user import User
from app.services import stock

router = APIRouter(prefix="/stock", tags=["inventory"])


async def stock_view_access(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> User:
    """Inventory and Kitchen users both need to see where stock sits."""
    if user.user_type == "owner":
        return user
    if not ({"inventory", "kitchen"} & await _user_allowed_modules(user, db)):
        raise HTTPException(403, "No access to stock")
    return user


class LocationItem(BaseModel):
    stock_type: str
    stock_id: uuid.UUID
    name: str
    unit: str
    category: str
    total_qty: float
    total_value: float
    by_location: dict[str, float]


class CostCenterRef(BaseModel):
    id: uuid.UUID
    label: str


class BalancesOut(BaseModel):
    cost_centers: list[CostCenterRef]
    items: list[LocationItem]


@router.get("/balances", response_model=BalancesOut)
async def balances(
    stock_type: str | None = None,
    cost_center_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(stock_view_access),
):
    """Item x cost-center matrix. Filtering by cost_center_id keeps only the
    items held there (and only that column's quantities)."""
    rows = await stock.location_balances(db, stock_type, cost_center_id)
    items: dict[tuple[str, uuid.UUID], LocationItem] = {}
    for r in rows:
        key = (r["stock_type"], r["stock_id"])
        item = items.get(key)
        if item is None:
            item = items[key] = LocationItem(
                stock_type=r["stock_type"], stock_id=r["stock_id"], name=r["name"], unit=r["unit"],
                category=r["category"], total_qty=0.0, total_value=0.0, by_location={},
            )
        item.by_location[str(r["cost_center_id"])] = round(r["qty"], 3)
        item.total_qty = round(item.total_qty + r["qty"], 3)
        item.total_value = round(item.total_value + r["value"], 3)
    ccs = (await db.execute(select(CostCenter).order_by(CostCenter.label))).scalars().all()
    return BalancesOut(
        cost_centers=[CostCenterRef(id=c.id, label=c.label) for c in ccs],
        items=sorted(items.values(), key=lambda i: i.name.lower()),
    )


class MovementOut(BaseModel):
    id: uuid.UUID
    created_at: datetime
    txn_type: str
    txn_code: str | None
    txn_id: uuid.UUID | None
    item_name: str
    stock_type: str
    stock_id: uuid.UUID
    unit: str
    from_cost_center: str | None
    to_cost_center: str | None
    qty: float
    unit_cost: float
    total_value: float
    user_name: str | None
    status: str
    is_reversal: bool


@router.get("/movements", response_model=list[MovementOut])
async def movements(
    cost_center_id: uuid.UUID | None = None,
    txn_type: str | None = None,
    item: str | None = None,
    txn_code: str | None = None,
    stock_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 500,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(stock_view_access),
):
    stmt = select(StockMovement).order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
    if cost_center_id:
        stmt = stmt.where(
            (StockMovement.from_cost_center_id == cost_center_id) | (StockMovement.to_cost_center_id == cost_center_id)
        )
    if txn_type:
        stmt = stmt.where(StockMovement.txn_type == txn_type)
    if item:
        stmt = stmt.where(StockMovement.item_name.ilike(f"%{item}%"))
    if txn_code:
        stmt = stmt.where(StockMovement.txn_code.ilike(f"%{txn_code}%"))
    if stock_id:
        stmt = stmt.where(StockMovement.stock_id == stock_id)
    if date_from:
        stmt = stmt.where(StockMovement.created_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
    if date_to:
        stmt = stmt.where(StockMovement.created_at <= datetime.combine(date_to, time.max, tzinfo=timezone.utc))
    rows = (await db.execute(stmt.limit(min(limit, 2000)))).scalars().all()
    labels = {c.id: c.label for c in (await db.execute(select(CostCenter))).scalars().all()}
    user_ids = {r.user_id for r in rows if r.user_id}
    names = dict((await db.execute(select(User.id, User.name).where(User.id.in_(user_ids)))).all()) if user_ids else {}
    return [
        MovementOut(
            id=r.id, created_at=r.created_at, txn_type=r.txn_type, txn_code=r.txn_code, txn_id=r.txn_id,
            item_name=r.item_name, stock_type=r.stock_type, stock_id=r.stock_id, unit=r.unit,
            from_cost_center=labels.get(r.from_cost_center_id) if r.from_cost_center_id else None,
            to_cost_center=labels.get(r.to_cost_center_id) if r.to_cost_center_id else None,
            qty=float(r.qty), unit_cost=float(r.unit_cost), total_value=float(r.total_value),
            user_name=names.get(r.user_id), status=r.status, is_reversal=r.reverses_id is not None,
        )
        for r in rows
    ]


class Mismatch(BaseModel):
    stock_type: str
    stock_id: uuid.UUID
    name: str
    ledger_qty: float
    location_qty: float
    rollup_qty: float


class ReconcileOut(BaseModel):
    ok: bool
    checked: int
    mismatches: list[Mismatch]


@router.get("/reconcile", response_model=ReconcileOut)
async def reconcile(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Owner-only: for every item, the ledger's net quantity must equal the
    sum of its location balances and its company-wide rollup."""
    if user.user_type != "owner":
        raise HTTPException(403, "Owner only")

    net = case((StockMovement.to_cost_center_id.is_not(None), StockMovement.qty), else_=0) - case(
        (StockMovement.from_cost_center_id.is_not(None), StockMovement.qty), else_=0
    )
    ledger = {
        (t, i): float(q)
        for t, i, q in (
            await db.execute(
                select(StockMovement.stock_type, StockMovement.stock_id, func.sum(net)).group_by(
                    StockMovement.stock_type, StockMovement.stock_id
                )
            )
        ).all()
    }
    location: dict[tuple[str, uuid.UUID], float] = {}
    for r in await stock.location_balances(db):
        key = (r["stock_type"], r["stock_id"])
        location[key] = location.get(key, 0.0) + r["qty"]

    mismatches: list[Mismatch] = []
    checked = 0
    for fi in (await db.execute(select(FoodInventory))).scalars().all():
        checked += 1
        key = ("food", fi.id)
        ledger_qty, loc_qty, rollup = ledger.get(key, 0.0), location.get(key, 0.0), float(fi.qty)
        if abs(ledger_qty - loc_qty) > 0.001 or abs(loc_qty - rollup) > 0.001:
            mismatches.append(Mismatch(stock_type="food", stock_id=fi.id, name=fi.name, ledger_qty=ledger_qty,
                                       location_qty=loc_qty, rollup_qty=rollup))
    for inv in (await db.execute(select(Inventory))).scalars().all():
        checked += 1
        key = ("general", inv.id)
        ledger_qty, loc_qty, rollup = ledger.get(key, 0.0), location.get(key, 0.0), float(inv.stock)
        if abs(ledger_qty - loc_qty) > 0.001 or abs(loc_qty - rollup) > 0.001:
            mismatches.append(Mismatch(stock_type="general", stock_id=inv.id, name=inv.name, ledger_qty=ledger_qty,
                                       location_qty=loc_qty, rollup_qty=rollup))
    return ReconcileOut(ok=not mismatches, checked=checked, mismatches=mismatches)

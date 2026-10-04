"""Read side of the stock engine: cost-center-wise balances, the movement
ledger, and a consistency check."""

import uuid
from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import _user_allowed_modules, get_current_user
from app.db.session import get_db
from app.models.kitchen import CostCenter, FoodInventory
from app.models.purchasing import Inventory
from app.models.stock import CostOfSales, PeriodClose, StockMovement
from app.models.user import User
from app.services import audit, stock
from app.services.cos import recompute_period

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


class CostOfSalesOut(BaseModel):
    id: uuid.UUID
    period: str
    cost_center_id: uuid.UUID
    cost_center: str
    stock_type: str
    stock_count_id: uuid.UUID | None
    count_date: date
    opening_value: float
    purchases: float
    transfers_in: float
    transfers_out: float
    closing_value: float
    cost_of_sales: float
    meals_value: float
    waste_value: float
    count_variance: float


@router.get("/cos", response_model=list[CostOfSalesOut])
async def cost_of_sales(
    cost_center_id: uuid.UUID | None = None,
    stock_type: str | None = None,
    period_from: str | None = None,
    period_to: str | None = None,
    stock_count_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(stock_view_access),
):
    """Monthly cost of sales per cost center, newest month first. Rows are
    written when a stock count is submitted (see app/services/cos.py)."""
    stmt = select(CostOfSales).order_by(CostOfSales.period.desc())
    if cost_center_id:
        stmt = stmt.where(CostOfSales.cost_center_id == cost_center_id)
    if stock_type:
        stmt = stmt.where(CostOfSales.stock_type == stock_type)
    if period_from:
        stmt = stmt.where(CostOfSales.period >= period_from)
    if period_to:
        stmt = stmt.where(CostOfSales.period <= period_to)
    if stock_count_id:
        stmt = stmt.where(CostOfSales.stock_count_id == stock_count_id)
    rows = (await db.execute(stmt)).scalars().all()
    labels = {c.id: c.label for c in (await db.execute(select(CostCenter))).scalars().all()}
    return [
        CostOfSalesOut(
            id=r.id, period=r.period, cost_center_id=r.cost_center_id, cost_center=labels.get(r.cost_center_id, "?"),
            stock_type=r.stock_type, stock_count_id=r.stock_count_id, count_date=r.count_date.date(),
            opening_value=float(r.opening_value), purchases=float(r.purchases), transfers_in=float(r.transfers_in),
            transfers_out=float(r.transfers_out), closing_value=float(r.closing_value), cost_of_sales=float(r.cost_of_sales),
            meals_value=float(r.meals_value), waste_value=float(r.waste_value), count_variance=float(r.count_variance),
        )
        for r in rows
    ]


# --------------------------------------------------------- month-end close --
class PeriodOut(BaseModel):
    period: str
    closed: bool
    closed_at: datetime | None
    closed_by_name: str | None
    reopened_at: datetime | None
    reopen_reason: str | None
    counted_centers: list[str]
    uncounted_centers: list[str]  # had stock activity but no submitted count


class ReopenIn(BaseModel):
    reason: str


def _require_period(period: str) -> None:
    try:
        datetime.strptime(period, "%Y-%m")
    except ValueError:
        raise HTTPException(400, "Period must look like 2026-09")


@router.get("/periods", response_model=list[PeriodOut])
async def periods(db: AsyncSession = Depends(get_db), _user: User = Depends(stock_view_access)):
    """Every month that has stock activity, a cost-of-sales record or a lock,
    newest first, with which cost centers have been counted."""
    labels = {c.id: c.label for c in (await db.execute(select(CostCenter))).scalars().all()}
    month = func.to_char(StockMovement.posting_date, "YYYY-MM")
    active: dict[str, set[uuid.UUID]] = {}
    for col in (StockMovement.to_cost_center_id, StockMovement.from_cost_center_id):
        rows = await db.execute(
            select(month, col).where(col.is_not(None), StockMovement.txn_type != "OPENING").distinct()
        )
        for period, cc in rows.all():
            active.setdefault(period, set()).add(cc)
    counted: dict[str, set[uuid.UUID]] = {}
    for period, cc in (await db.execute(select(CostOfSales.period, CostOfSales.cost_center_id).distinct())).all():
        counted.setdefault(period, set()).add(cc)
    closes = {c.period: c for c in (await db.execute(select(PeriodClose))).scalars().all()}
    closer_ids = {c.closed_by for c in closes.values() if c.closed_by}
    names = dict((await db.execute(select(User.id, User.name).where(User.id.in_(closer_ids)))).all()) if closer_ids else {}
    out = []
    for period in sorted(set(active) | set(counted) | set(closes), reverse=True):
        close = closes.get(period)
        done = counted.get(period, set())
        out.append(
            PeriodOut(
                period=period, closed=bool(close and close.closed), closed_at=close.closed_at if close else None,
                closed_by_name=names.get(close.closed_by) if close else None,
                reopened_at=close.reopened_at if close else None, reopen_reason=close.reopen_reason if close else None,
                counted_centers=sorted(labels.get(c, "?") for c in done),
                uncounted_centers=sorted(labels.get(c, "?") for c in active.get(period, set()) - done),
            )
        )
    return out


def _owner_only(user: User) -> None:
    if user.user_type != "owner":
        raise HTTPException(403, "Only the owner (Super User) can close or reopen a month")


@router.post("/periods/{period}/close", response_model=PeriodOut)
async def close_period(period: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Recalculates the month's cost of sales from the ledger, then locks the
    month against any further stock postings."""
    _owner_only(user)
    _require_period(period)
    row = (await db.execute(select(PeriodClose).where(PeriodClose.period == period))).scalar_one_or_none()
    if row and row.closed:
        raise HTTPException(400, f"{period} is already closed")
    refreshed = await recompute_period(db, period)
    if row is None:
        row = PeriodClose(period=period)
        db.add(row)
    row.closed, row.closed_by, row.closed_at = True, user.id, datetime.now(timezone.utc)
    await db.flush()
    await audit.record(db, user, "period", row.id, period, "close", changes={"cost_of_sales_refreshed": refreshed})
    await db.commit()
    return next(p for p in await periods(db, user) if p.period == period)


@router.post("/periods/{period}/reopen", response_model=PeriodOut)
async def reopen_period(
    period: str, payload: ReopenIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    _owner_only(user)
    _require_period(period)
    if not payload.reason.strip():
        raise HTTPException(400, "A reason is required to reopen a closed month")
    row = (await db.execute(select(PeriodClose).where(PeriodClose.period == period))).scalar_one_or_none()
    if not row or not row.closed:
        raise HTTPException(400, f"{period} is not closed")
    row.closed, row.reopened_by, row.reopened_at, row.reopen_reason = False, user.id, datetime.now(timezone.utc), payload.reason.strip()
    await audit.record(db, user, "period", row.id, period, "reopen", reason=payload.reason.strip())
    await db.commit()
    return next(p for p in await periods(db, user) if p.period == period)


# ------------------------------------------------------------- consumption --
CONSUMPTION_TYPES = ("MEAL_LOG", "WASTE", "COUNT")


class ConsumptionRow(BaseModel):
    key: str
    label: str
    unit: str | None  # only for the per-item grouping
    qty: float | None
    meals_value: float
    waste_value: float
    count_variance: float
    total_value: float


class ConsumptionReport(BaseModel):
    rows: list[ConsumptionRow]
    total_value: float
    note: str


@router.get("/consumption", response_model=ConsumptionReport)
async def consumption(
    group_by: str = "item",
    date_from: date | None = None,
    date_to: date | None = None,
    cost_center_id: uuid.UUID | None = None,
    stock_type: str | None = None,
    item: str | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(stock_view_access),
):
    """Stock used up in a period, valued at the cost of the stock actually
    drawn: meals served, waste, and what stock counts found missing (net of
    surpluses and reversals). Transfers between locations are not consumption."""
    m = StockMovement
    orig = aliased(StockMovement)
    eff = func.coalesce(orig.txn_type, m.txn_type)
    outbound = m.from_cost_center_id.is_not(None)
    sign = case((outbound, 1), else_=-1)  # a reversal or surplus flows back in
    location = func.coalesce(m.from_cost_center_id, m.to_cost_center_id)
    keys = {
        "item": m.item_name, "cost_center": location, "month": func.to_char(m.posting_date, "YYYY-MM"), "type": eff,
    }
    if group_by not in keys:
        raise HTTPException(400, "group_by must be item, cost_center, month or type")
    key_col = keys[group_by]
    stmt = (
        select(key_col, eff, func.min(m.unit), func.sum(sign * m.qty), func.sum(sign * m.total_value))
        .select_from(m).outerjoin(orig, orig.id == m.reverses_id)
        .where(eff.in_(CONSUMPTION_TYPES))
        .group_by(key_col, eff)
    )
    if date_from:
        stmt = stmt.where(m.posting_date >= date_from)
    if date_to:
        stmt = stmt.where(m.posting_date <= date_to)
    if cost_center_id:
        stmt = stmt.where((m.from_cost_center_id == cost_center_id) | (m.to_cost_center_id == cost_center_id))
    if stock_type:
        stmt = stmt.where(m.stock_type == stock_type)
    if item:
        stmt = stmt.where(m.item_name.ilike(f"%{item}%"))
    labels = {c.id: c.label for c in (await db.execute(select(CostCenter))).scalars().all()}
    acc: dict[str, dict] = {}
    for key, kind, unit, qty, value in (await db.execute(stmt)).all():
        row = acc.setdefault(str(key), {"unit": unit, "qty": 0.0, "MEAL_LOG": 0.0, "WASTE": 0.0, "COUNT": 0.0})
        row["qty"] += float(qty)
        row[kind] += float(value)
    rows = [
        ConsumptionRow(
            key=k, label=labels.get(uuid.UUID(k), "?") if group_by == "cost_center" else k,
            unit=v["unit"] if group_by == "item" else None, qty=round(v["qty"], 3) if group_by == "item" else None,
            meals_value=round(v["MEAL_LOG"], 2), waste_value=round(v["WASTE"], 2), count_variance=round(v["COUNT"], 2),
            total_value=round(v["MEAL_LOG"] + v["WASTE"] + v["COUNT"], 2),
        )
        for k, v in acc.items()
    ]
    rows.sort(key=(lambda r: r.key) if group_by == "month" else (lambda r: -r.total_value))
    return ConsumptionReport(
        rows=rows, total_value=round(sum(r.total_value for r in rows), 2),
        note="Valued at the cost of the stock actually used (batch costs). Meals + waste + count variance.",
    )

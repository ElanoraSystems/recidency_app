import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import local_today
from app.api.deps import require_module
from app.crud.activity import log_activity
from app.db.session import get_db
from app.models.kitchen import CostCenter, FoodInventory
from app.models.purchasing import Inventory, ItemMaster, StockCount, StockCountLine
from app.models.user import User
from app.services import stock
from app.services.cos import record_cost_of_sales

router = APIRouter(prefix="/stock-counts", tags=["inventory"])
inventory_access = require_module("inventory")

DEFAULT_LOCATION = "Main Store"


async def _book_qty_and_cost(
    db: AsyncSession, stock_type: str, stock_id: uuid.UUID, cc_id: uuid.UUID
) -> tuple[float, float]:
    """Book qty is the balance at the counted location; cost is the item's
    current weighted cost."""
    qty = await stock.balance(db, stock_type, stock_id, cc_id)
    if stock_type == "food":
        row = await db.get(FoodInventory, stock_id)
        return (qty, float(row.cost)) if row else (0.0, 0.0)
    row = await db.get(Inventory, stock_id)
    return (qty, float(row.avg_price)) if row else (0.0, 0.0)


class StockCountLineOut(BaseModel):
    id: uuid.UUID
    item_master_id: uuid.UUID
    item_name: str
    uom: str
    book_qty: float
    counted_qty: float | None
    unit_cost: float


class StockCountOut(BaseModel):
    id: uuid.UUID
    date: date
    status: str
    cost_center_id: uuid.UUID | None
    cost_center: str | None
    counted_by: uuid.UUID | None
    notes: str | None
    lines: list[StockCountLineOut]


class StockCountSummary(BaseModel):
    id: uuid.UUID
    date: date
    status: str
    cost_center: str | None
    item_count: int
    variance_value: float


class StockCountIn(BaseModel):
    cost_center_id: uuid.UUID | None = None


async def _line_out(db: AsyncSession, line: StockCountLine, item: ItemMaster | None = None) -> StockCountLineOut:
    if item is None:
        item = await db.get(ItemMaster, line.item_master_id)
    return StockCountLineOut(
        id=line.id,
        item_master_id=line.item_master_id,
        item_name=item.name if item else "Unknown item",
        uom=item.uom if item else "",
        book_qty=float(line.book_qty),
        counted_qty=float(line.counted_qty) if line.counted_qty is not None else None,
        unit_cost=float(line.unit_cost),
    )


async def _count_out(db: AsyncSession, count: StockCount) -> StockCountOut:
    lines = (await db.execute(select(StockCountLine).where(StockCountLine.count_id == count.id))).scalars().all()
    item_ids = [line.item_master_id for line in lines]
    items: dict[uuid.UUID, ItemMaster] = {}
    if item_ids:
        rows = (await db.execute(select(ItemMaster).where(ItemMaster.id.in_(item_ids)))).scalars().all()
        items = {row.id: row for row in rows}
    return StockCountOut(
        id=count.id,
        date=count.date,
        status=count.status,
        cost_center_id=count.cost_center_id,
        cost_center=await stock.cost_center_label(db, count.cost_center_id) if count.cost_center_id else None,
        counted_by=count.counted_by,
        notes=count.notes,
        lines=[await _line_out(db, line, items.get(line.item_master_id)) for line in lines],
    )


@router.post("", response_model=StockCountOut, status_code=201)
async def create_stock_count(
    payload: StockCountIn | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(inventory_access),
):
    """Starts a Draft count of one location, snapshotting every active item's
    book qty there so stock movement during the count doesn't shift the baseline."""
    cc_id = payload.cost_center_id if payload else None
    if cc_id is None:
        cc_id = (await db.execute(select(CostCenter.id).where(CostCenter.label == DEFAULT_LOCATION))).scalar_one_or_none()
    if cc_id is None or not await db.get(CostCenter, cc_id):
        raise HTTPException(400, "Select a cost center to count")
    count = StockCount(date=local_today(), status="Draft", counted_by=user.id, cost_center_id=cc_id)
    db.add(count)
    await db.flush()

    items = (await db.execute(select(ItemMaster).where(ItemMaster.active))).scalars().all()
    for item in items:
        qty, cost = await _book_qty_and_cost(db, item.stock_type, item.stock_id, cc_id)
        db.add(StockCountLine(count_id=count.id, item_master_id=item.id, book_qty=qty, unit_cost=cost))

    await log_activity(db, user, "Started stock count", f"{len(items)} items")
    await db.commit()
    await db.refresh(count)
    return await _count_out(db, count)


@router.get("", response_model=list[StockCountSummary])
async def list_stock_counts(db: AsyncSession = Depends(get_db), _user: User = Depends(inventory_access)):
    counts = (await db.execute(select(StockCount).order_by(StockCount.date.desc()))).scalars().all()
    out = []
    for count in counts:
        lines = (await db.execute(select(StockCountLine).where(StockCountLine.count_id == count.id))).scalars().all()
        variance_value = sum(
            (float(line.counted_qty) - float(line.book_qty)) * float(line.unit_cost)
            for line in lines if line.counted_qty is not None
        )
        out.append(StockCountSummary(
            id=count.id, date=count.date, status=count.status,
            cost_center=await stock.cost_center_label(db, count.cost_center_id) if count.cost_center_id else None,
            item_count=len(lines), variance_value=round(variance_value, 2),
        ))
    return out


@router.get("/{count_id}", response_model=StockCountOut)
async def get_stock_count(
    count_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(inventory_access)
):
    count = await db.get(StockCount, count_id)
    if not count:
        raise HTTPException(404, "Stock count not found")
    return await _count_out(db, count)


class StockCountLinePatch(BaseModel):
    counted_qty: float | None = None


@router.patch("/{count_id}/lines/{line_id}", response_model=StockCountLineOut)
async def update_stock_count_line(
    count_id: uuid.UUID,
    line_id: uuid.UUID,
    payload: StockCountLinePatch,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(inventory_access),
):
    count = await db.get(StockCount, count_id)
    if not count:
        raise HTTPException(404, "Stock count not found")
    if count.status != "Draft":
        raise HTTPException(400, "Only a Draft count can be edited")
    line = await db.get(StockCountLine, line_id)
    if not line or line.count_id != count_id:
        raise HTTPException(404, "Stock count line not found")
    line.counted_qty = payload.counted_qty
    await db.commit()
    await db.refresh(line)
    return await _line_out(db, line)


@router.post("/{count_id}/submit", response_model=StockCountOut)
async def submit_stock_count(
    count_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(inventory_access)
):
    """Posts each counted line's variance onto the counted location. A
    shortfall comes off the earliest-expiring batches first (shrinkage most
    plausibly hits what's about to expire); a surplus lands as a new
    no-expiry batch."""
    count = await db.get(StockCount, count_id)
    if not count:
        raise HTTPException(404, "Stock count not found")
    if count.status != "Draft":
        raise HTTPException(400, "This count was already submitted")
    if not count.cost_center_id:
        raise HTTPException(400, "This count has no location")

    txn_code = f"SC-{str(count.id)[:6].upper()}"
    lines = (await db.execute(select(StockCountLine).where(StockCountLine.count_id == count_id))).scalars().all()
    for line in lines:
        if line.counted_qty is None:
            continue
        variance = float(line.counted_qty) - float(line.book_qty)
        if abs(variance) < stock.EPS:
            continue
        item = await db.get(ItemMaster, line.item_master_id)
        if not item:
            continue
        if variance < 0:
            await stock.post_out(
                db, stock_type=item.stock_type, stock_id=item.stock_id, cc_id=count.cost_center_id, qty=-variance,
                txn_type="COUNT", txn_id=count.id, txn_code=txn_code, user=user,
            )
        else:
            await stock.post_in(
                db, stock_type=item.stock_type, stock_id=item.stock_id, cc_id=count.cost_center_id, qty=variance,
                unit_cost=float(line.unit_cost), txn_type="COUNT", txn_id=count.id, txn_code=txn_code, user=user,
                batch_label="Count adjustment",
            )

    count.status = "Submitted"
    count.counted_by = user.id
    await db.flush()
    await record_cost_of_sales(db, count.cost_center_id, count.id, count.date)
    await log_activity(db, user, "Submitted stock count", str(count.date))
    await db.commit()
    await db.refresh(count)
    return await _count_out(db, count)


@router.delete("/{count_id}", status_code=204)
async def delete_stock_count(
    count_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(inventory_access)
):
    count = await db.get(StockCount, count_id)
    if not count:
        raise HTTPException(404, "Stock count not found")
    if count.status != "Draft":
        raise HTTPException(400, "Only a Draft count can be deleted")
    await db.execute(delete(StockCountLine).where(StockCountLine.count_id == count_id))
    await db.delete(count)
    await db.commit()

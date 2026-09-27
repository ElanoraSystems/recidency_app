import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_module
from app.api.v1.kitchen import _consume_fefo, _recompute_food_rollup
from app.crud.activity import log_activity
from app.db.session import get_db
from app.models.kitchen import FoodInventory, FoodInventoryBatch
from app.models.purchasing import Inventory, ItemMaster, StockCount, StockCountLine
from app.models.user import User

router = APIRouter(prefix="/stock-counts", tags=["inventory"])
inventory_access = require_module("inventory")


async def _stock_qty(stock_type: str, stock_id: uuid.UUID, db: AsyncSession) -> tuple[float, float]:
    if stock_type == "food":
        stock = await db.get(FoodInventory, stock_id)
        return (float(stock.qty), float(stock.cost)) if stock else (0.0, 0.0)
    stock = await db.get(Inventory, stock_id)
    return (float(stock.stock), float(stock.avg_price)) if stock else (0.0, 0.0)


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
    counted_by: uuid.UUID | None
    notes: str | None
    lines: list[StockCountLineOut]


class StockCountSummary(BaseModel):
    id: uuid.UUID
    date: date
    status: str
    item_count: int
    variance_value: float


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
        counted_by=count.counted_by,
        notes=count.notes,
        lines=[await _line_out(db, line, items.get(line.item_master_id)) for line in lines],
    )


@router.post("", response_model=StockCountOut, status_code=201)
async def create_stock_count(db: AsyncSession = Depends(get_db), user: User = Depends(inventory_access)):
    """Starts a Draft count, snapshotting every active item's book qty/cost
    so stock movement during the count doesn't shift the baseline."""
    count = StockCount(date=date.today(), status="Draft", counted_by=user.id)
    db.add(count)
    await db.flush()

    items = (await db.execute(select(ItemMaster).where(ItemMaster.active))).scalars().all()
    for item in items:
        qty, cost = await _stock_qty(item.stock_type, item.stock_id, db)
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
    """Posts each counted line's variance onto real stock. A food shortfall
    comes off the earliest-expiring batch first (shrinkage most plausibly
    hits what's about to expire); a surplus lands as a new no-expiry batch."""
    count = await db.get(StockCount, count_id)
    if not count:
        raise HTTPException(404, "Stock count not found")
    if count.status != "Draft":
        raise HTTPException(400, "This count was already submitted")

    lines = (await db.execute(select(StockCountLine).where(StockCountLine.count_id == count_id))).scalars().all()
    for line in lines:
        if line.counted_qty is None:
            continue
        variance = float(line.counted_qty) - float(line.book_qty)
        if variance == 0:
            continue
        item = await db.get(ItemMaster, line.item_master_id)
        if not item:
            continue
        if item.stock_type == "food":
            if variance < 0:
                await _consume_fefo(db, item.stock_id, -variance)
            else:
                db.add(
                    FoodInventoryBatch(
                        food_inventory_id=item.stock_id, batch_label="Count adjustment",
                        qty=variance, expiry=None, cost=float(line.unit_cost), received_date=date.today(),
                    )
                )
                await db.flush()
                await _recompute_food_rollup(db, item.stock_id)
        else:
            stock = await db.get(Inventory, item.stock_id)
            if stock:
                stock.stock = max(0, float(stock.stock) + variance)

    count.status = "Submitted"
    count.counted_by = user.id
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

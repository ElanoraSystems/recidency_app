"""Location-aware stock engine. Every stock change goes through here so each
one is a ledger row (StockMovement) and each location's balance stays exact.

Food stock is kept as FEFO batches, each sitting at one cost center; general
stock keeps one InventoryBalance row per (item, cost center). The company-wide
FoodInventory.qty/cost/expiry and Inventory.stock are rollups this module
maintains, so every reader of those columns keeps working unchanged."""

import uuid
from datetime import date

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.kitchen import CostCenter, FoodInventory, FoodInventoryBatch
from app.models.purchasing import Inventory
from app.models.stock import InventoryBalance, StockMovement
from app.models.user import User

EPS = 0.0005  # quantities are stored to 3 decimals


class InsufficientStock(HTTPException):
    def __init__(self, item: str, location: str, available: float, needed: float):
        super().__init__(
            409,
            f"Insufficient stock of {item} at {location}: {available:g} available, {needed:g} needed",
        )


def _q(value: float) -> float:
    return round(float(value), 3)


async def cost_center_label(db: AsyncSession, cc_id: uuid.UUID | None) -> str:
    if cc_id is None:
        return "-"
    cc = await db.get(CostCenter, cc_id)
    return cc.label if cc else str(cc_id)


async def _item(db: AsyncSession, stock_type: str, stock_id: uuid.UUID):
    model = FoodInventory if stock_type == "food" else Inventory
    item = await db.get(model, stock_id)
    if not item:
        raise HTTPException(404, "Stock item not found")
    return item


# ------------------------------------------------------------ rollups --
async def recompute_food_rollup(db: AsyncSession, food_inventory_id: uuid.UUID) -> None:
    """Rewrites FoodInventory.qty/.cost/.expiry/.batch from its live batches
    across every location."""
    stock = await db.get(FoodInventory, food_inventory_id)
    if not stock:
        return
    batches = (
        await db.execute(
            select(FoodInventoryBatch).where(
                FoodInventoryBatch.food_inventory_id == food_inventory_id, FoodInventoryBatch.qty > 0
            )
        )
    ).scalars().all()
    total_qty = sum(float(b.qty) for b in batches)
    total_value = sum(float(b.qty) * float(b.cost) for b in batches)
    stock.qty = total_qty
    stock.cost = (total_value / total_qty) if total_qty > 0 else 0.0
    soonest = min((b for b in batches if b.expiry is not None), key=lambda b: b.expiry, default=None)
    stock.expiry = soonest.expiry if soonest else None
    stock.batch = soonest.batch_label if soonest else None


async def recompute_general_total(db: AsyncSession, inventory_id: uuid.UUID) -> None:
    inv = await db.get(Inventory, inventory_id)
    if not inv:
        return
    total = (
        await db.execute(
            select(func.coalesce(func.sum(InventoryBalance.qty), 0)).where(
                InventoryBalance.inventory_id == inventory_id
            )
        )
    ).scalar_one()
    inv.stock = float(total)


async def _rollup(db: AsyncSession, stock_type: str, stock_id: uuid.UUID) -> None:
    if stock_type == "food":
        await recompute_food_rollup(db, stock_id)
    else:
        await recompute_general_total(db, stock_id)


# ----------------------------------------------------------- balances --
async def balance(db: AsyncSession, stock_type: str, stock_id: uuid.UUID, cc_id: uuid.UUID) -> float:
    if stock_type == "food":
        total = (
            await db.execute(
                select(func.coalesce(func.sum(FoodInventoryBatch.qty), 0)).where(
                    FoodInventoryBatch.food_inventory_id == stock_id,
                    FoodInventoryBatch.cost_center_id == cc_id,
                    FoodInventoryBatch.qty > 0,
                )
            )
        ).scalar_one()
        return float(total)
    row = (
        await db.execute(
            select(InventoryBalance.qty).where(
                InventoryBalance.inventory_id == stock_id, InventoryBalance.cost_center_id == cc_id
            )
        )
    ).scalar_one_or_none()
    return float(row) if row is not None else 0.0


async def _fefo_batches(db: AsyncSession, food_id: uuid.UUID, cc_id: uuid.UUID) -> list[FoodInventoryBatch]:
    return list(
        (
            await db.execute(
                select(FoodInventoryBatch)
                .where(
                    FoodInventoryBatch.food_inventory_id == food_id,
                    FoodInventoryBatch.cost_center_id == cc_id,
                    FoodInventoryBatch.qty > 0,
                )
                .order_by(
                    FoodInventoryBatch.expiry.is_(None), FoodInventoryBatch.expiry, FoodInventoryBatch.received_date
                )
                .with_for_update()
            )
        ).scalars().all()
    )


async def _locked_balance(db: AsyncSession, inventory_id: uuid.UUID, cc_id: uuid.UUID) -> InventoryBalance:
    row = (
        await db.execute(
            select(InventoryBalance)
            .where(InventoryBalance.inventory_id == inventory_id, InventoryBalance.cost_center_id == cc_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        row = InventoryBalance(inventory_id=inventory_id, cost_center_id=cc_id, qty=0)
        db.add(row)
        await db.flush()
    return row


def _movement(
    *, txn_type, txn_id, txn_code, stock_type, stock_id, item, from_cc, to_cc, qty, unit_cost, user,
    batch_id=None, source_batch_id=None,
) -> StockMovement:
    return StockMovement(
        txn_type=txn_type, txn_id=txn_id, txn_code=txn_code, stock_type=stock_type, stock_id=stock_id,
        item_name=item.name, unit=item.unit, from_cost_center_id=from_cc, to_cost_center_id=to_cc, qty=qty,
        unit_cost=unit_cost, total_value=round(qty * unit_cost, 4), batch_id=batch_id,
        source_batch_id=source_batch_id, user_id=user.id if user else None, status="Posted",
    )


# ------------------------------------------------------------ posting --
async def post_in(
    db: AsyncSession, *, stock_type: str, stock_id: uuid.UUID, cc_id: uuid.UUID, qty: float,
    unit_cost: float, txn_type: str, txn_id: uuid.UUID | None, txn_code: str | None, user: User | None,
    batch_label: str | None = None, expiry: date | None = None, received_date: date | None = None,
) -> StockMovement:
    qty = _q(qty)
    if qty <= 0:
        raise HTTPException(400, "Quantity must be greater than zero")
    item = await _item(db, stock_type, stock_id)
    batch_id = None
    if stock_type == "food":
        batch = FoodInventoryBatch(
            food_inventory_id=stock_id, batch_label=batch_label, qty=qty, expiry=expiry, cost=unit_cost,
            received_date=received_date or date.today(), cost_center_id=cc_id,
        )
        db.add(batch)
        await db.flush()
        batch_id = batch.id
    else:
        bal = await _locked_balance(db, stock_id, cc_id)
        bal.qty = _q(float(bal.qty) + qty)
    movement = _movement(
        txn_type=txn_type, txn_id=txn_id, txn_code=txn_code, stock_type=stock_type, stock_id=stock_id,
        item=item, from_cc=None, to_cc=cc_id, qty=qty, unit_cost=unit_cost, user=user, batch_id=batch_id,
    )
    db.add(movement)
    await db.flush()
    await _rollup(db, stock_type, stock_id)
    return movement


async def post_out(
    db: AsyncSession, *, stock_type: str, stock_id: uuid.UUID, cc_id: uuid.UUID, qty: float,
    txn_type: str, txn_id: uuid.UUID | None, txn_code: str | None, user: User | None,
) -> list[StockMovement]:
    """Takes stock out of one location (earliest-expiring food batches first).
    Raises InsufficientStock, writing nothing, if the location has too little."""
    qty = _q(qty)
    if qty <= 0:
        raise HTTPException(400, "Quantity must be greater than zero")
    item = await _item(db, stock_type, stock_id)
    movements: list[StockMovement] = []
    if stock_type == "food":
        batches = await _fefo_batches(db, stock_id, cc_id)
        available = sum(float(b.qty) for b in batches)
        if available + EPS < qty:
            raise InsufficientStock(item.name, await cost_center_label(db, cc_id), available, qty)
        remaining = qty
        for batch in batches:
            if remaining <= EPS:
                break
            take = _q(min(float(batch.qty), remaining))
            batch.qty = _q(float(batch.qty) - take)
            remaining = _q(remaining - take)
            movements.append(
                _movement(
                    txn_type=txn_type, txn_id=txn_id, txn_code=txn_code, stock_type=stock_type,
                    stock_id=stock_id, item=item, from_cc=cc_id, to_cc=None, qty=take,
                    unit_cost=float(batch.cost), user=user, batch_id=batch.id,
                )
            )
    else:
        bal = await _locked_balance(db, stock_id, cc_id)
        if float(bal.qty) + EPS < qty:
            raise InsufficientStock(item.name, await cost_center_label(db, cc_id), float(bal.qty), qty)
        bal.qty = _q(float(bal.qty) - qty)
        movements.append(
            _movement(
                txn_type=txn_type, txn_id=txn_id, txn_code=txn_code, stock_type=stock_type, stock_id=stock_id,
                item=item, from_cc=cc_id, to_cc=None, qty=qty, unit_cost=float(item.avg_price), user=user,
            )
        )
    db.add_all(movements)
    await db.flush()
    await _rollup(db, stock_type, stock_id)
    return movements


async def post_transfer(
    db: AsyncSession, *, stock_type: str, stock_id: uuid.UUID, from_cc: uuid.UUID, to_cc: uuid.UUID,
    qty: float, txn_type: str, txn_id: uuid.UUID | None, txn_code: str | None, user: User | None,
) -> list[StockMovement]:
    """Moves stock between two locations. Batches keep their cost, expiry and
    label at the destination, so company-wide qty and value are unchanged."""
    if from_cc == to_cc:
        raise HTTPException(400, "From and To cost centers must be different")
    qty = _q(qty)
    if qty <= 0:
        raise HTTPException(400, "Quantity must be greater than zero")
    item = await _item(db, stock_type, stock_id)
    movements: list[StockMovement] = []
    if stock_type == "food":
        batches = await _fefo_batches(db, stock_id, from_cc)
        available = sum(float(b.qty) for b in batches)
        if available + EPS < qty:
            raise InsufficientStock(item.name, await cost_center_label(db, from_cc), available, qty)
        remaining = qty
        for batch in batches:
            if remaining <= EPS:
                break
            take = _q(min(float(batch.qty), remaining))
            batch.qty = _q(float(batch.qty) - take)
            remaining = _q(remaining - take)
            label_match = (
                FoodInventoryBatch.batch_label.is_(None)
                if batch.batch_label is None
                else FoodInventoryBatch.batch_label == batch.batch_label
            )
            expiry_match = (
                FoodInventoryBatch.expiry.is_(None) if batch.expiry is None else FoodInventoryBatch.expiry == batch.expiry
            )
            dest = (
                await db.execute(
                    select(FoodInventoryBatch)
                    .where(
                        FoodInventoryBatch.food_inventory_id == stock_id,
                        FoodInventoryBatch.cost_center_id == to_cc,
                        label_match,
                        expiry_match,
                        FoodInventoryBatch.cost == batch.cost,
                    )
                    .with_for_update()
                )
            ).scalars().first()
            if dest is None:
                dest = FoodInventoryBatch(
                    food_inventory_id=stock_id, batch_label=batch.batch_label, qty=take, expiry=batch.expiry,
                    cost=batch.cost, received_date=batch.received_date, cost_center_id=to_cc,
                )
                db.add(dest)
                await db.flush()
            else:
                dest.qty = _q(float(dest.qty) + take)
            movements.append(
                _movement(
                    txn_type=txn_type, txn_id=txn_id, txn_code=txn_code, stock_type=stock_type,
                    stock_id=stock_id, item=item, from_cc=from_cc, to_cc=to_cc, qty=take,
                    unit_cost=float(batch.cost), user=user, batch_id=dest.id, source_batch_id=batch.id,
                )
            )
    else:
        src = await _locked_balance(db, stock_id, from_cc)
        if float(src.qty) + EPS < qty:
            raise InsufficientStock(item.name, await cost_center_label(db, from_cc), float(src.qty), qty)
        dst = await _locked_balance(db, stock_id, to_cc)
        src.qty = _q(float(src.qty) - qty)
        dst.qty = _q(float(dst.qty) + qty)
        movements.append(
            _movement(
                txn_type=txn_type, txn_id=txn_id, txn_code=txn_code, stock_type=stock_type, stock_id=stock_id,
                item=item, from_cc=from_cc, to_cc=to_cc, qty=qty, unit_cost=float(item.avg_price), user=user,
            )
        )
    db.add_all(movements)
    await db.flush()
    await _rollup(db, stock_type, stock_id)
    return movements


def weighted_unit_cost(movements: list[StockMovement]) -> float:
    qty = sum(float(m.qty) for m in movements)
    return sum(float(m.qty) * float(m.unit_cost) for m in movements) / qty if qty else 0.0


# ----------------------------------------------------------- reversal --
async def reverse_txn(db: AsyncSession, txn_id: uuid.UUID, user: User | None) -> list[StockMovement]:
    """Undoes every active posting of a transaction by appending inverse
    ledger rows and restoring the exact batches/balances it touched. Fails
    (writing nothing) if received stock has since been used up."""
    originals = list(
        (
            await db.execute(
                select(StockMovement)
                .where(
                    StockMovement.txn_id == txn_id,
                    StockMovement.status == "Posted",
                    StockMovement.txn_type != "REVERSAL",
                )
                .order_by(StockMovement.created_at, StockMovement.id)
            )
        ).scalars().all()
    )
    touched: set[tuple[str, uuid.UUID]] = set()
    reversals: list[StockMovement] = []
    for m in originals:
        touched.add((m.stock_type, m.stock_id))
        if m.stock_type == "food":
            if m.to_cost_center_id and m.batch_id:
                dest = (
                    await db.execute(
                        select(FoodInventoryBatch).where(FoodInventoryBatch.id == m.batch_id).with_for_update()
                    )
                ).scalar_one_or_none()
                if dest is None or float(dest.qty) + EPS < float(m.qty):
                    raise HTTPException(
                        409,
                        f"Cannot reverse: {m.item_name} received at "
                        f"{await cost_center_label(db, m.to_cost_center_id)} has already been used",
                    )
                dest.qty = _q(float(dest.qty) - float(m.qty))
            if m.from_cost_center_id:
                src_id = m.source_batch_id or (m.batch_id if not m.to_cost_center_id else None)
                src = await db.get(FoodInventoryBatch, src_id) if src_id else None
                if src is not None:
                    src.qty = _q(float(src.qty) + float(m.qty))
                else:
                    db.add(
                        FoodInventoryBatch(
                            food_inventory_id=m.stock_id, batch_label="Reversal", qty=float(m.qty), expiry=None,
                            cost=float(m.unit_cost), received_date=date.today(), cost_center_id=m.from_cost_center_id,
                        )
                    )
        else:
            if m.to_cost_center_id:
                bal = await _locked_balance(db, m.stock_id, m.to_cost_center_id)
                if float(bal.qty) + EPS < float(m.qty):
                    raise InsufficientStock(
                        m.item_name, await cost_center_label(db, m.to_cost_center_id), float(bal.qty), float(m.qty)
                    )
                bal.qty = _q(float(bal.qty) - float(m.qty))
            if m.from_cost_center_id:
                bal = await _locked_balance(db, m.stock_id, m.from_cost_center_id)
                bal.qty = _q(float(bal.qty) + float(m.qty))
        reversals.append(
            StockMovement(
                txn_type="REVERSAL", txn_id=m.txn_id, txn_code=m.txn_code, stock_type=m.stock_type,
                stock_id=m.stock_id, item_name=m.item_name, unit=m.unit,
                from_cost_center_id=m.to_cost_center_id, to_cost_center_id=m.from_cost_center_id,
                qty=m.qty, unit_cost=m.unit_cost, total_value=m.total_value, batch_id=m.batch_id,
                source_batch_id=m.source_batch_id, user_id=user.id if user else None, status="Posted",
                reverses_id=m.id,
            )
        )
        m.status = "Reversed"
    db.add_all(reversals)
    await db.flush()
    for stock_type, stock_id in touched:
        await _rollup(db, stock_type, stock_id)
    return reversals


# ------------------------------------------------------------ reports --
async def location_balances(
    db: AsyncSession, stock_type: str | None = None, cc_id: uuid.UUID | None = None
) -> list[dict]:
    """One row per (item, location) holding stock."""
    rows: list[dict] = []
    if stock_type in (None, "food"):
        stmt = (
            select(
                FoodInventory.id, FoodInventory.name, FoodInventory.unit, FoodInventory.category,
                FoodInventoryBatch.cost_center_id, func.sum(FoodInventoryBatch.qty),
                func.sum(FoodInventoryBatch.qty * FoodInventoryBatch.cost),
            )
            .join(FoodInventoryBatch, FoodInventoryBatch.food_inventory_id == FoodInventory.id)
            .where(FoodInventoryBatch.qty > 0)
            .group_by(
                FoodInventory.id, FoodInventory.name, FoodInventory.unit, FoodInventory.category,
                FoodInventoryBatch.cost_center_id,
            )
        )
        if cc_id:
            stmt = stmt.where(FoodInventoryBatch.cost_center_id == cc_id)
        for sid, name, unit, category, cc, qty, value in (await db.execute(stmt)).all():
            rows.append({"stock_type": "food", "stock_id": sid, "name": name, "unit": unit,
                         "category": category, "cost_center_id": cc, "qty": float(qty), "value": float(value or 0)})
    if stock_type in (None, "general"):
        stmt = (
            select(
                Inventory.id, Inventory.name, Inventory.unit, Inventory.category, InventoryBalance.cost_center_id,
                InventoryBalance.qty, InventoryBalance.qty * Inventory.avg_price,
            )
            .join(InventoryBalance, InventoryBalance.inventory_id == Inventory.id)
            .where(InventoryBalance.qty > 0)
        )
        if cc_id:
            stmt = stmt.where(InventoryBalance.cost_center_id == cc_id)
        for sid, name, unit, category, cc, qty, value in (await db.execute(stmt)).all():
            rows.append({"stock_type": "general", "stock_id": sid, "name": name, "unit": unit,
                         "category": category, "cost_center_id": cc, "qty": float(qty), "value": float(value or 0)})
    return rows


async def ensure_opening_balances(db: AsyncSession, cc_id: uuid.UUID, user: User | None = None) -> None:
    """For seeds: turns any stock that exists only as a bare qty (no batches /
    balances) into an opening position at `cc_id`, so the ledger covers it."""
    foods = (await db.execute(select(FoodInventory).where(FoodInventory.qty > 0))).scalars().all()
    for food in foods:
        has_batches = (
            await db.execute(
                select(func.count()).select_from(FoodInventoryBatch).where(
                    FoodInventoryBatch.food_inventory_id == food.id
                )
            )
        ).scalar_one()
        if not has_batches:
            await post_in(
                db, stock_type="food", stock_id=food.id, cc_id=cc_id, qty=float(food.qty),
                unit_cost=float(food.cost), txn_type="OPENING", txn_id=None, txn_code=None, user=user,
                batch_label="Opening", expiry=food.expiry,
            )
    generals = (await db.execute(select(Inventory).where(Inventory.stock > 0))).scalars().all()
    for inv in generals:
        has_balance = (
            await db.execute(
                select(func.count()).select_from(InventoryBalance).where(InventoryBalance.inventory_id == inv.id)
            )
        ).scalar_one()
        if not has_balance:
            await post_in(
                db, stock_type="general", stock_id=inv.id, cc_id=cc_id, qty=float(inv.stock),
                unit_cost=float(inv.avg_price), txn_type="OPENING", txn_id=None, txn_code=None, user=user,
            )

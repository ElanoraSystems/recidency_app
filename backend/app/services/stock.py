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

from app.core.clock import local_today
from app.models.kitchen import CostCenter, FoodInventory, FoodInventoryBatch
from app.models.purchasing import Inventory, ItemMaster
from app.models.stock import InventoryBalance, PeriodClose, StockMovement
from app.models.user import User

EPS = 0.0005  # quantities are stored to 3 decimals
DEFICIT = "Deficit"  # label of the lot that records stock consumed before it was received


class InsufficientStock(HTTPException):
    def __init__(self, item: str, location: str, available: float, needed: float):
        super().__init__(
            409,
            f"Insufficient stock of {item} at {location}: {available:g} available, {needed:g} needed",
        )


async def ensure_period_open(db: AsyncSession, on: date) -> None:
    """Postings into a closed month are refused; the owner must reopen it."""
    period = on.strftime("%Y-%m")
    closed = (
        await db.execute(select(PeriodClose.id).where(PeriodClose.period == period, PeriodClose.closed))
    ).first()
    if closed:
        raise HTTPException(409, f"{period} is closed - the owner must reopen that month before anything can post into it")


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
    """Rewrites FoodInventory.qty/.expiry/.batch from its live batches across
    every location. Quantity includes any deficit lot (negative); the cost is
    the moving weighted average and is maintained on receipt, never derived
    from what happens to be on the shelf."""
    stock = await db.get(FoodInventory, food_inventory_id)
    if not stock:
        return
    batches = (
        await db.execute(select(FoodInventoryBatch).where(FoodInventoryBatch.food_inventory_id == food_inventory_id))
    ).scalars().all()
    stock.qty = sum(float(b.qty) for b in batches)
    live = [b for b in batches if float(b.qty) > 0]
    soonest = min((b for b in live if b.expiry is not None), key=lambda b: b.expiry, default=None)
    stock.expiry = soonest.expiry if soonest else None
    stock.batch = soonest.batch_label if soonest else None


async def _set_cost(db: AsyncSession, food: FoodInventory, new_cost: float) -> None:
    if abs(new_cost - float(food.cost or 0)) < 0.0000005:
        return
    food.cost = max(0.0, new_cost)
    # Recipes using this ingredient now cost differently: keep a history.
    from app.services.recipe_costing import snapshot_for_food

    await snapshot_for_food(db, food.id, "Average cost changed")


async def issue_cost(db: AsyncSession, food: FoodInventory) -> float:
    """What stock leaving the item is valued at: its moving average cost, or
    for an item never bought the Item Master price."""
    if float(food.cost or 0) > 0:
        return float(food.cost)
    price = (
        await db.execute(
            select(ItemMaster.last_price).where(ItemMaster.stock_type == "food", ItemMaster.stock_id == food.id)
        )
    ).scalar_one_or_none()
    return float(price or 0)


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
    batch_id=None, source_batch_id=None, on: date | None = None,
) -> StockMovement:
    return StockMovement(
        txn_type=txn_type, txn_id=txn_id, txn_code=txn_code, stock_type=stock_type, stock_id=stock_id,
        item_name=item.name, unit=item.unit, from_cost_center_id=from_cc, to_cost_center_id=to_cc, qty=qty,
        unit_cost=unit_cost, total_value=round(qty * unit_cost, 4), batch_id=batch_id,
        source_batch_id=source_batch_id, user_id=user.id if user else None, status="Posted",
        posting_date=on or local_today(),
    )


# ------------------------------------------------------------ posting --
async def post_in(
    db: AsyncSession, *, stock_type: str, stock_id: uuid.UUID, cc_id: uuid.UUID, qty: float,
    unit_cost: float, txn_type: str, txn_id: uuid.UUID | None, txn_code: str | None, user: User | None,
    batch_label: str | None = None, expiry: date | None = None, received_date: date | None = None,
    on: date | None = None,
) -> StockMovement:
    await ensure_period_open(db, on or local_today())
    qty = _q(qty)
    if qty <= 0:
        raise HTTPException(400, "Quantity must be greater than zero")
    item = await _item(db, stock_type, stock_id)
    batch_id = None
    extra: list[StockMovement] = []
    if stock_type == "food":
        # Moving weighted average: blend the receipt into what is on hand. With
        # nothing on hand (or a deficit) the receipt sets the price.
        old_qty, old_cost = float(item.qty or 0), float(item.cost or 0)
        await _set_cost(db, item, (old_qty * old_cost + qty * unit_cost) / (old_qty + qty) if old_qty > EPS else unit_cost)
        remaining = qty
        deficit = (
            await db.execute(
                select(FoodInventoryBatch)
                .where(
                    FoodInventoryBatch.food_inventory_id == stock_id, FoodInventoryBatch.cost_center_id == cc_id,
                    FoodInventoryBatch.qty < 0,
                )
                .with_for_update()
            )
        ).scalars().first()
        if deficit is not None:  # stock consumed before it arrived is covered first
            cover = _q(min(-float(deficit.qty), remaining))
            deficit.qty = _q(float(deficit.qty) + cover)
            remaining = _q(remaining - cover)
            extra.append(
                _movement(
                    txn_type=txn_type, txn_id=txn_id, txn_code=txn_code, stock_type=stock_type, stock_id=stock_id,
                    item=item, from_cc=None, to_cc=cc_id, qty=cover, unit_cost=unit_cost, user=user,
                    batch_id=deficit.id, on=on,
                )
            )
        if remaining > EPS:
            batch = FoodInventoryBatch(
                food_inventory_id=stock_id, batch_label=batch_label, qty=remaining, expiry=expiry, cost=unit_cost,
                received_date=received_date or local_today(), cost_center_id=cc_id,
            )
            db.add(batch)
            await db.flush()
            batch_id = batch.id
            qty = remaining
        else:
            db.add_all(extra)
            await db.flush()
            await _rollup(db, stock_type, stock_id)
            return extra[0]
    else:
        bal = await _locked_balance(db, stock_id, cc_id)
        bal.qty = _q(float(bal.qty) + qty)
    movement = _movement(
        txn_type=txn_type, txn_id=txn_id, txn_code=txn_code, stock_type=stock_type, stock_id=stock_id,
        item=item, from_cc=None, to_cc=cc_id, qty=qty, unit_cost=unit_cost, user=user, batch_id=batch_id, on=on,
    )
    db.add_all([*extra, movement])
    await db.flush()
    await _rollup(db, stock_type, stock_id)
    return extra[0] if extra else movement


async def post_out(
    db: AsyncSession, *, stock_type: str, stock_id: uuid.UUID, cc_id: uuid.UUID, qty: float,
    txn_type: str, txn_id: uuid.UUID | None, txn_code: str | None, user: User | None, on: date | None = None,
    allow_negative: bool = False,
) -> list[StockMovement]:
    """Takes stock out of one location (earliest-expiring food batches first),
    valued at the item's moving average cost. Raises InsufficientStock, writing
    nothing, if the location has too little - unless allow_negative (meals),
    in which case the shortfall is recorded as a deficit that a later receipt
    covers."""
    await ensure_period_open(db, on or local_today())
    qty = _q(qty)
    if qty <= 0:
        raise HTTPException(400, "Quantity must be greater than zero")
    item = await _item(db, stock_type, stock_id)
    movements: list[StockMovement] = []
    if stock_type == "food":
        batches = await _fefo_batches(db, stock_id, cc_id)
        available = sum(float(b.qty) for b in batches)
        if available + EPS < qty and not allow_negative:
            raise InsufficientStock(item.name, await cost_center_label(db, cc_id), available, qty)
        cost = await issue_cost(db, item)
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
                    unit_cost=cost, user=user, batch_id=batch.id, on=on,
                )
            )
        if remaining > EPS:  # only reachable with allow_negative
            deficit = (
                await db.execute(
                    select(FoodInventoryBatch)
                    .where(
                        FoodInventoryBatch.food_inventory_id == stock_id, FoodInventoryBatch.cost_center_id == cc_id,
                        FoodInventoryBatch.batch_label == DEFICIT,
                    )
                    .with_for_update()
                )
            ).scalars().first()
            if deficit is None:
                deficit = FoodInventoryBatch(
                    food_inventory_id=stock_id, batch_label=DEFICIT, qty=0, expiry=None, cost=cost,
                    received_date=local_today(), cost_center_id=cc_id,
                )
                db.add(deficit)
                await db.flush()
            deficit.qty = _q(float(deficit.qty) - remaining)
            movements.append(
                _movement(
                    txn_type=txn_type, txn_id=txn_id, txn_code=txn_code, stock_type=stock_type, stock_id=stock_id,
                    item=item, from_cc=cc_id, to_cc=None, qty=remaining, unit_cost=cost, user=user,
                    batch_id=deficit.id, on=on,
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
                item=item, from_cc=cc_id, to_cc=None, qty=qty, unit_cost=float(item.avg_price), user=user, on=on,
            )
        )
    db.add_all(movements)
    await db.flush()
    await _rollup(db, stock_type, stock_id)
    return movements


async def post_transfer(
    db: AsyncSession, *, stock_type: str, stock_id: uuid.UUID, from_cc: uuid.UUID, to_cc: uuid.UUID,
    qty: float, txn_type: str, txn_id: uuid.UUID | None, txn_code: str | None, user: User | None,
    on: date | None = None,
) -> list[StockMovement]:
    """Moves stock between two locations. Batches keep their cost, expiry and
    label at the destination, so company-wide qty and value are unchanged."""
    if from_cc == to_cc:
        raise HTTPException(400, "From and To cost centers must be different")
    await ensure_period_open(db, on or local_today())
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
        cost = await issue_cost(db, item)
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
                    unit_cost=cost, user=user, batch_id=dest.id, source_batch_id=batch.id, on=on,
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
                item=item, from_cc=from_cc, to_cc=to_cc, qty=qty, unit_cost=float(item.avg_price), user=user, on=on,
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
    for posting_date in {m.posting_date for m in originals}:
        await ensure_period_open(db, posting_date)
    touched: set[tuple[str, uuid.UUID]] = set()
    reversals: list[StockMovement] = []
    running: dict[uuid.UUID, list[float]] = {}  # food item -> [qty, moving average] as the reversal proceeds
    for m in originals:
        touched.add((m.stock_type, m.stock_id))
        if m.stock_type == "food":
            if m.stock_id not in running:
                food = await db.get(FoodInventory, m.stock_id)
                running[m.stock_id] = [float(food.qty or 0), float(food.cost or 0)]
            state = running[m.stock_id]
            if m.to_cost_center_id and not m.from_cost_center_id:
                # A receipt being undone takes its value back out of the average.
                left = state[0] - float(m.qty)
                if left > EPS:
                    state[1] = max(0.0, (state[0] * state[1] - float(m.qty) * float(m.unit_cost)) / left)
                state[0] = left
            elif m.from_cost_center_id and not m.to_cost_center_id:
                # Stock coming back in at the cost it left at.
                if state[0] > EPS:
                    state[1] = (state[0] * state[1] + float(m.qty) * float(m.unit_cost)) / (state[0] + float(m.qty))
                state[0] += float(m.qty)
            if m.to_cost_center_id and m.batch_id:
                dest = (
                    await db.execute(
                        select(FoodInventoryBatch).where(FoodInventoryBatch.id == m.batch_id).with_for_update()
                    )
                ).scalar_one_or_none()
                if dest is None or (dest.batch_label != DEFICIT and float(dest.qty) + EPS < float(m.qty)):
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
                            cost=float(m.unit_cost), received_date=local_today(), cost_center_id=m.from_cost_center_id,
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
                reverses_id=m.id, posting_date=m.posting_date,
            )
        )
        m.status = "Reversed"
    db.add_all(reversals)
    await db.flush()
    for stock_type, stock_id in touched:
        await _rollup(db, stock_type, stock_id)
    for food_id, (_qty, cost) in running.items():
        await _set_cost(db, await db.get(FoodInventory, food_id), cost)
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
                func.sum(FoodInventoryBatch.qty) * FoodInventory.cost,
            )
            .join(FoodInventoryBatch, FoodInventoryBatch.food_inventory_id == FoodInventory.id)
            .where(FoodInventoryBatch.qty != 0)
            .group_by(
                FoodInventory.id, FoodInventory.name, FoodInventory.unit, FoodInventory.category, FoodInventory.cost,
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

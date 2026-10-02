"""Kitchen transactions - Log Meal, Raw Material Transfer, Waste Log.

Each is a header + lines document that follows the standard workflow
(app/services/workflow.py): Draft is freely editable and has no stock effect;
Submit posts the stock movements against the document's cost center(s)."""

import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.kitchen import (
    _expand_consumption,
    _residence_pdf_context,
    _resolve_recipe,
    kitchen_access,
)
from app.crud.activity import log_activity
from app.db.session import get_db
from app.models.kitchen import (
    ConsumptionLog,
    CostCenter,
    FoodInventory,
    MealLog,
    MealLogLine,
    Recipe,
    StockTransfer,
    StockTransferLine,
    WasteLog,
    WasteLogLine,
)
from app.models.purchasing import ItemMaster
from app.models.user import User
from app.services import audit, stock, workflow
from app.services.codes import next_code
from app.services.pdf import render_pdf

router = APIRouter(prefix="/kitchen", tags=["kitchen"])


# ----------------------------------------------------------------- shared --
async def _cc_labels(db: AsyncSession) -> dict[uuid.UUID, str]:
    return {cc.id: cc.label for cc in (await db.execute(select(CostCenter))).scalars().all()}


async def _user_names(db: AsyncSession, ids: set[uuid.UUID | None]) -> dict[uuid.UUID, str]:
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    rows = (await db.execute(select(User.id, User.name).where(User.id.in_(wanted)))).all()
    return {uid: name for uid, name in rows}


async def _require_cost_center(db: AsyncSession, cc_id: uuid.UUID) -> CostCenter:
    cc = await db.get(CostCenter, cc_id)
    if not cc:
        raise HTTPException(400, "Select a valid cost center")
    return cc


class Stamps(BaseModel):
    status: str
    logged_by_name: str | None
    submitted_by_name: str | None
    submitted_at: datetime | None
    approved_by_name: str | None
    approved_at: datetime | None
    closed_by_name: str | None
    closed_at: datetime | None


def _stamps(doc, names: dict[uuid.UUID, str]) -> dict:
    return {
        "status": doc.status,
        "logged_by_name": names.get(doc.logged_by),
        "submitted_by_name": names.get(doc.submitted_by),
        "submitted_at": doc.submitted_at,
        "approved_by_name": names.get(doc.approved_by),
        "approved_at": doc.approved_at,
        "closed_by_name": names.get(doc.closed_by),
        "closed_at": doc.closed_at,
    }


def _stamp_ids(docs) -> set[uuid.UUID | None]:
    ids: set[uuid.UUID | None] = set()
    for d in docs:
        ids.update({d.logged_by, d.submitted_by, d.approved_by, d.closed_by})
    return ids


# --------------------------------------------------------------- meal log --
class MealLogLineIn(BaseModel):
    recipe_id: uuid.UUID | None = None
    dish: str | None = None
    qty: int
    unit_cost: float | None = None  # only for custom (non-recipe) dishes


class MealLogIn(BaseModel):
    date: date
    cost_center_id: uuid.UUID
    category: str | None = None
    notes: str | None = None
    lines: list[MealLogLineIn]


class MealLogLineOut(BaseModel):
    id: uuid.UUID
    recipe_id: uuid.UUID | None
    dish: str
    qty: int
    unit: str
    unit_cost: float
    line_cost: float


class MealLogOut(Stamps):
    id: uuid.UUID
    code: str
    date: date
    cost_center_id: uuid.UUID
    cost_center: str
    category: str | None
    notes: str | None
    total: float
    lines: list[MealLogLineOut]


def _meal_lines_out(lines: list[MealLogLine]) -> list[MealLogLineOut]:
    return [
        MealLogLineOut(
            id=l.id, recipe_id=l.recipe_id, dish=l.dish, qty=l.qty, unit=l.unit, unit_cost=float(l.unit_cost),
            line_cost=round(l.qty * float(l.unit_cost), 3),
        )
        for l in lines
    ]


async def _meal_outs(db: AsyncSession, meals: list[MealLog]) -> list[MealLogOut]:
    if not meals:
        return []
    labels = await _cc_labels(db)
    names = await _user_names(db, _stamp_ids(meals))
    lines = (
        await db.execute(select(MealLogLine).where(MealLogLine.meal_log_id.in_([m.id for m in meals])))
    ).scalars().all()
    by_meal: dict[uuid.UUID, list[MealLogLine]] = {}
    for line in lines:
        by_meal.setdefault(line.meal_log_id, []).append(line)
    out = []
    for m in meals:
        ml = _meal_lines_out(by_meal.get(m.id, []))
        out.append(
            MealLogOut(
                id=m.id, code=m.code, date=m.date, cost_center_id=m.cost_center_id,
                cost_center=labels.get(m.cost_center_id, m.cost_center or "-"), category=m.category, notes=m.notes,
                total=round(sum(l.line_cost for l in ml), 3), lines=ml, **_stamps(m, names),
            )
        )
    return out


async def _meal_snapshot(db: AsyncSession, meal: MealLog) -> dict:
    labels = await _cc_labels(db)
    lines = (await db.execute(select(MealLogLine).where(MealLogLine.meal_log_id == meal.id))).scalars().all()
    return {
        "date": meal.date.isoformat(), "cost_center": labels.get(meal.cost_center_id), "category": meal.category,
        "notes": meal.notes, "lines": [{"dish": l.dish, "qty": l.qty, "unit_cost": float(l.unit_cost)} for l in lines],
    }


async def _write_meal_lines(db: AsyncSession, meal: MealLog, payload: MealLogIn) -> None:
    if not payload.lines:
        raise HTTPException(400, "Add at least one dish")
    for line in payload.lines:
        if line.qty <= 0:
            raise HTTPException(400, "Quantity must be greater than zero")
        if line.recipe_id:
            recipe = await db.get(Recipe, line.recipe_id)
            if not recipe:
                raise HTTPException(404, "Recipe not found")
            cost, _ = await _resolve_recipe(db, recipe)
            dish, unit_cost = recipe.name, cost.cost_per_portion
        else:
            if not (line.dish or "").strip():
                raise HTTPException(400, "Enter a dish name or choose a recipe")
            dish, unit_cost = line.dish.strip(), line.unit_cost or 0.0
        db.add(MealLogLine(meal_log_id=meal.id, recipe_id=line.recipe_id, dish=dish, qty=line.qty,
                           unit="portion", unit_cost=unit_cost))


@router.get("/meal-log", response_model=list[MealLogOut])
async def list_meal_log(db: AsyncSession = Depends(get_db), _user: User = Depends(kitchen_access)):
    meals = (await db.execute(select(MealLog).order_by(MealLog.date.desc(), MealLog.code.desc()))).scalars().all()
    return await _meal_outs(db, list(meals))


@router.get("/meal-log/{meal_id}", response_model=MealLogOut)
async def get_meal_log(meal_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(kitchen_access)):
    meal = await db.get(MealLog, meal_id)
    if not meal:
        raise HTTPException(404, "Meal log not found")
    return (await _meal_outs(db, [meal]))[0]


@router.post("/meal-log", response_model=MealLogOut, status_code=201)
async def create_meal_log(
    payload: MealLogIn, db: AsyncSession = Depends(get_db), user: User = Depends(kitchen_access)
):
    cc = await _require_cost_center(db, payload.cost_center_id)
    meal = MealLog(
        code=await next_code(db, MealLog, "ML", 1001), date=payload.date, cost_center_id=cc.id,
        cost_center=cc.label, category=payload.category, notes=payload.notes, logged_by=user.id,
    )
    db.add(meal)
    await db.flush()
    await _write_meal_lines(db, meal, payload)
    await audit.record(db, user, "meal_log", meal.id, meal.code, "create", to_status=workflow.DRAFT)
    await log_activity(db, user, "Created meal log", meal.code)
    await db.commit()
    return (await _meal_outs(db, [meal]))[0]


@router.put("/meal-log/{meal_id}", response_model=MealLogOut)
async def update_meal_log(
    meal_id: uuid.UUID, payload: MealLogIn, db: AsyncSession = Depends(get_db), user: User = Depends(kitchen_access)
):
    meal = await db.get(MealLog, meal_id)
    if not meal:
        raise HTTPException(404, "Meal log not found")
    workflow.ensure_editable(meal, user)
    cc = await _require_cost_center(db, payload.cost_center_id)
    before = await _meal_snapshot(db, meal)
    meal.date, meal.cost_center_id, meal.cost_center = payload.date, cc.id, cc.label
    meal.category, meal.notes = payload.category, payload.notes
    await db.execute(delete(MealLogLine).where(MealLogLine.meal_log_id == meal.id))
    await _write_meal_lines(db, meal, payload)
    await db.flush()
    await audit.record(db, user, "meal_log", meal.id, meal.code, "edit",
                       changes={"before": before, "after": await _meal_snapshot(db, meal)})
    await db.commit()
    return (await _meal_outs(db, [meal]))[0]


@router.delete("/meal-log/{meal_id}", status_code=204)
async def delete_meal_log(
    meal_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(kitchen_access)
):
    meal = await db.get(MealLog, meal_id)
    if not meal:
        raise HTTPException(404, "Meal log not found")
    workflow.ensure_editable(meal, user)
    await audit.record(db, user, "meal_log", meal.id, meal.code, "delete", from_status=meal.status)
    await db.delete(meal)
    await db.commit()


async def _post_meal_log(db: AsyncSession, meal: MealLog, user: User) -> None:
    """Recipe lines draw their ingredients from the meal's cost center."""
    lines = (await db.execute(select(MealLogLine).where(MealLogLine.meal_log_id == meal.id))).scalars().all()
    if not lines:
        raise HTTPException(400, "Add at least one dish before submitting")
    for line in lines:
        if not line.recipe_id:
            continue
        recipe = await db.get(Recipe, line.recipe_id)
        if not recipe:
            raise HTTPException(400, f"The recipe for '{line.dish}' no longer exists")
        recipe_cost, _ = await _resolve_recipe(db, recipe)
        line.unit_cost = recipe_cost.cost_per_portion
        # Scale = fraction of the recipe's full authored batch (raw_yield_g)
        # served, e.g. 4 portions from a batch that yields 10 => 0.4.
        scale = line.qty / (recipe_cost.portions or 1)
        consumed: dict[uuid.UUID, tuple[FoodInventory, float]] = {}
        for item, qty in await _expand_consumption(db, recipe, scale):
            prev = consumed.get(item.id, (item, 0.0))[1]
            consumed[item.id] = (item, prev + qty)
        for item, qty in consumed.values():
            if round(qty, 3) <= 0:
                continue
            await stock.post_out(
                db, stock_type="food", stock_id=item.id, cc_id=meal.cost_center_id, qty=qty,
                txn_type="MEAL_LOG", txn_id=meal.id, txn_code=meal.code, user=user,
            )
            db.add(
                ConsumptionLog(
                    date=meal.date, recipe_id=recipe.id, dish=recipe.name, meals_served=line.qty,
                    ingredient=item.name, qty_consumed=round(qty, 3), unit=item.unit,
                    matched_stock_id=item.id, meal_log_id=meal.id,
                )
            )


async def _unpost_meal_log(db: AsyncSession, meal: MealLog, user: User) -> None:
    await db.execute(delete(ConsumptionLog).where(ConsumptionLog.meal_log_id == meal.id))


async def _invoice_context(db: AsyncSession, out) -> dict:
    """Shared by the meal, transfer and waste invoices: the client's own name
    in the header and the preparer + sign-offs underneath."""
    ctx = await _residence_pdf_context(db)
    ctx["residence"] = {**ctx["residence"], "name": "Hadlaan House"}
    return {
        **ctx,
        "doc_code": out.code,
        "prepared_by": out.logged_by_name,
    }


@router.get("/meal-log/{meal_id}/invoice-pdf")
async def meal_log_invoice_pdf(
    meal_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(kitchen_access)
):
    meal = await db.get(MealLog, meal_id)
    if not meal:
        raise HTTPException(404, "Meal log not found")
    out = (await _meal_outs(db, [meal]))[0]
    pdf_bytes = render_pdf(
        "invoice.html",
        {
            **await _invoice_context(db, out),
            "title": out.cost_center,
            "subtitle": f"{out.code} - {out.status}",
            "date": out.date.isoformat(),
            "line_items": [
                {"name": l.dish, "qty": float(l.qty), "unit": l.unit, "unit_cost": l.unit_cost, "line_total": l.line_cost}
                for l in out.lines
            ],
            "total": out.total,
        },
    )
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{out.code}.pdf"'},
    )


# --------------------------------------------------------- stock transfers --
class StockTransferLineIn(BaseModel):
    food_inventory_id: uuid.UUID
    qty: float


class StockTransferIn(BaseModel):
    date: date
    from_cost_center_id: uuid.UUID
    to_cost_center_id: uuid.UUID
    reason: str = "Transfer"
    notes: str | None = None
    lines: list[StockTransferLineIn]


class StockTransferLineOut(BaseModel):
    id: uuid.UUID
    food_inventory_id: uuid.UUID | None
    ingredient_name: str
    qty: float
    unit: str
    unit_cost: float
    line_cost: float


class StockTransferOut(Stamps):
    id: uuid.UUID
    code: str
    date: date
    from_cost_center_id: uuid.UUID
    from_cost_center: str
    to_cost_center_id: uuid.UUID | None
    to_cost_center: str | None
    reason: str
    notes: str | None
    total: float
    lines: list[StockTransferLineOut]


async def _transfer_outs(db: AsyncSession, transfers: list[StockTransfer]) -> list[StockTransferOut]:
    if not transfers:
        return []
    labels = await _cc_labels(db)
    names = await _user_names(db, _stamp_ids(transfers))
    lines = (
        await db.execute(
            select(StockTransferLine).where(StockTransferLine.transfer_id.in_([t.id for t in transfers]))
        )
    ).scalars().all()
    by_transfer: dict[uuid.UUID, list[StockTransferLine]] = {}
    for line in lines:
        by_transfer.setdefault(line.transfer_id, []).append(line)
    out = []
    for t in transfers:
        tl = [
            StockTransferLineOut(
                id=l.id, food_inventory_id=l.food_inventory_id, ingredient_name=l.ingredient_name, qty=float(l.qty),
                unit=l.unit, unit_cost=float(l.unit_cost), line_cost=round(float(l.qty) * float(l.unit_cost), 3),
            )
            for l in by_transfer.get(t.id, [])
        ]
        out.append(
            StockTransferOut(
                id=t.id, code=t.code, date=t.date, from_cost_center_id=t.from_cost_center_id,
                from_cost_center=labels.get(t.from_cost_center_id, "-"), to_cost_center_id=t.to_cost_center_id,
                to_cost_center=labels.get(t.to_cost_center_id) if t.to_cost_center_id else None, reason=t.reason,
                notes=t.notes, total=round(sum(l.line_cost for l in tl), 3), lines=tl, **_stamps(t, names),
            )
        )
    return out


async def _validate_transfer(db: AsyncSession, payload: StockTransferIn) -> list[tuple[FoodInventory, float]]:
    await _require_cost_center(db, payload.from_cost_center_id)
    await _require_cost_center(db, payload.to_cost_center_id)
    if payload.from_cost_center_id == payload.to_cost_center_id:
        raise HTTPException(400, "From and To cost centers must be different")
    if not payload.lines:
        raise HTTPException(400, "Add at least one raw material line")
    resolved = []
    for line in payload.lines:
        if line.qty <= 0:
            raise HTTPException(400, "Quantity must be greater than zero")
        item = await db.get(FoodInventory, line.food_inventory_id)
        if not item:
            raise HTTPException(404, "One of the selected stock items was not found")
        resolved.append((item, line.qty))
    return resolved


async def _write_transfer_lines(db: AsyncSession, transfer: StockTransfer, resolved) -> None:
    for item, qty in resolved:
        db.add(StockTransferLine(transfer_id=transfer.id, food_inventory_id=item.id, ingredient_name=item.name,
                                 qty=qty, unit=item.unit, unit_cost=float(item.cost)))


async def _transfer_snapshot(db: AsyncSession, t: StockTransfer) -> dict:
    labels = await _cc_labels(db)
    lines = (await db.execute(select(StockTransferLine).where(StockTransferLine.transfer_id == t.id))).scalars().all()
    return {
        "date": t.date.isoformat(), "from": labels.get(t.from_cost_center_id),
        "to": labels.get(t.to_cost_center_id) if t.to_cost_center_id else None, "reason": t.reason,
        "notes": t.notes, "lines": [{"item": l.ingredient_name, "qty": float(l.qty)} for l in lines],
    }


@router.get("/stock-transfers", response_model=list[StockTransferOut])
async def list_stock_transfers(db: AsyncSession = Depends(get_db), _user: User = Depends(kitchen_access)):
    rows = (
        await db.execute(select(StockTransfer).order_by(StockTransfer.date.desc(), StockTransfer.code.desc()))
    ).scalars().all()
    return await _transfer_outs(db, list(rows))


@router.get("/stock-transfers/{transfer_id}", response_model=StockTransferOut)
async def get_stock_transfer(
    transfer_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(kitchen_access)
):
    transfer = await db.get(StockTransfer, transfer_id)
    if not transfer:
        raise HTTPException(404, "Stock transfer not found")
    return (await _transfer_outs(db, [transfer]))[0]


@router.post("/stock-transfers", response_model=StockTransferOut, status_code=201)
async def create_stock_transfer(
    payload: StockTransferIn, db: AsyncSession = Depends(get_db), user: User = Depends(kitchen_access)
):
    resolved = await _validate_transfer(db, payload)
    transfer = StockTransfer(
        code=await next_code(db, StockTransfer, "RT", 1001), date=payload.date,
        from_cost_center_id=payload.from_cost_center_id, to_cost_center_id=payload.to_cost_center_id,
        reason=payload.reason, notes=payload.notes, logged_by=user.id,
    )
    db.add(transfer)
    await db.flush()
    await _write_transfer_lines(db, transfer, resolved)
    await audit.record(db, user, "stock_transfer", transfer.id, transfer.code, "create", to_status=workflow.DRAFT)
    await log_activity(db, user, "Created raw material transfer", transfer.code)
    await db.commit()
    return (await _transfer_outs(db, [transfer]))[0]


@router.put("/stock-transfers/{transfer_id}", response_model=StockTransferOut)
async def update_stock_transfer(
    transfer_id: uuid.UUID, payload: StockTransferIn, db: AsyncSession = Depends(get_db),
    user: User = Depends(kitchen_access),
):
    transfer = await db.get(StockTransfer, transfer_id)
    if not transfer:
        raise HTTPException(404, "Stock transfer not found")
    workflow.ensure_editable(transfer, user)
    resolved = await _validate_transfer(db, payload)
    before = await _transfer_snapshot(db, transfer)
    transfer.date, transfer.reason, transfer.notes = payload.date, payload.reason, payload.notes
    transfer.from_cost_center_id, transfer.to_cost_center_id = payload.from_cost_center_id, payload.to_cost_center_id
    await db.execute(delete(StockTransferLine).where(StockTransferLine.transfer_id == transfer.id))
    await _write_transfer_lines(db, transfer, resolved)
    await db.flush()
    await audit.record(db, user, "stock_transfer", transfer.id, transfer.code, "edit",
                       changes={"before": before, "after": await _transfer_snapshot(db, transfer)})
    await db.commit()
    return (await _transfer_outs(db, [transfer]))[0]


@router.delete("/stock-transfers/{transfer_id}", status_code=204)
async def delete_stock_transfer(
    transfer_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(kitchen_access)
):
    transfer = await db.get(StockTransfer, transfer_id)
    if not transfer:
        raise HTTPException(404, "Stock transfer not found")
    workflow.ensure_editable(transfer, user)
    await audit.record(db, user, "stock_transfer", transfer.id, transfer.code, "delete", from_status=transfer.status)
    await db.delete(transfer)
    await db.commit()


async def _post_transfer(db: AsyncSession, transfer: StockTransfer, user: User) -> None:
    if not transfer.to_cost_center_id:
        raise HTTPException(400, "Choose a destination cost center before submitting")
    lines = (
        await db.execute(select(StockTransferLine).where(StockTransferLine.transfer_id == transfer.id))
    ).scalars().all()
    if not lines:
        raise HTTPException(400, "Add at least one raw material line before submitting")
    for line in lines:
        if not line.food_inventory_id:
            raise HTTPException(400, f"'{line.ingredient_name}' is no longer in stock records")
        movements = await stock.post_transfer(
            db, stock_type="food", stock_id=line.food_inventory_id, from_cc=transfer.from_cost_center_id,
            to_cc=transfer.to_cost_center_id, qty=float(line.qty), txn_type="TRANSFER", txn_id=transfer.id,
            txn_code=transfer.code, user=user,
        )
        line.unit_cost = stock.weighted_unit_cost(movements)


@router.get("/stock-transfers/{transfer_id}/invoice-pdf")
async def stock_transfer_invoice_pdf(
    transfer_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(kitchen_access)
):
    transfer = await db.get(StockTransfer, transfer_id)
    if not transfer:
        raise HTTPException(404, "Stock transfer not found")
    out = (await _transfer_outs(db, [transfer]))[0]
    pdf_bytes = render_pdf(
        "invoice.html",
        {
            **await _invoice_context(db, out),
            "title": f"Raw material transfer {out.code}",
            "subtitle": f"{out.from_cost_center} -> {out.to_cost_center or '-'}",
            "date": out.date.isoformat(),
            "line_items": [
                {"name": l.ingredient_name, "qty": l.qty, "unit": l.unit, "unit_cost": l.unit_cost,
                 "line_total": l.line_cost}
                for l in out.lines
            ],
            "total": out.total,
        },
    )
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{out.code}.pdf"'},
    )


# --------------------------------------------------------------- waste log --
class WasteLogLineIn(BaseModel):
    food_inventory_id: uuid.UUID
    qty: float


class WasteLogIn(BaseModel):
    date: date
    cost_center_id: uuid.UUID
    reason: str
    notes: str | None = None
    lines: list[WasteLogLineIn]


class WasteLogLineOut(BaseModel):
    id: uuid.UUID
    food_inventory_id: uuid.UUID | None
    item_master_id: uuid.UUID | None
    ingredient_name: str
    qty: float
    unit: str
    unit_cost: float
    line_cost: float


class WasteLogOut(Stamps):
    id: uuid.UUID
    code: str
    date: date
    cost_center_id: uuid.UUID
    cost_center: str
    reason: str
    notes: str | None
    total: float
    reviewed_by_name: str | None
    lines: list[WasteLogLineOut]


async def _waste_outs(db: AsyncSession, wastes: list[WasteLog]) -> list[WasteLogOut]:
    if not wastes:
        return []
    labels = await _cc_labels(db)
    names = await _user_names(db, _stamp_ids(wastes))
    lines = (
        await db.execute(select(WasteLogLine).where(WasteLogLine.waste_log_id.in_([w.id for w in wastes])))
    ).scalars().all()
    by_waste: dict[uuid.UUID, list[WasteLogLine]] = {}
    for line in lines:
        by_waste.setdefault(line.waste_log_id, []).append(line)
    out = []
    for w in wastes:
        wl = [
            WasteLogLineOut(
                id=l.id, food_inventory_id=l.food_inventory_id, item_master_id=l.item_master_id,
                ingredient_name=l.ingredient_name, qty=float(l.qty), unit=l.unit, unit_cost=float(l.unit_cost),
                line_cost=round(float(l.qty) * float(l.unit_cost), 3),
            )
            for l in by_waste.get(w.id, [])
        ]
        stamps = _stamps(w, names)
        out.append(
            WasteLogOut(
                id=w.id, code=w.code, date=w.date, cost_center_id=w.cost_center_id,
                cost_center=labels.get(w.cost_center_id, "-"), reason=w.reason, notes=w.notes,
                total=round(sum(l.line_cost for l in wl), 3), reviewed_by_name=stamps["approved_by_name"],
                lines=wl, **stamps,
            )
        )
    return out


async def _validate_waste(db: AsyncSession, payload: WasteLogIn) -> list[tuple[FoodInventory, float, ItemMaster | None]]:
    await _require_cost_center(db, payload.cost_center_id)
    if not payload.lines:
        raise HTTPException(400, "Add at least one wasted item")
    resolved = []
    for line in payload.lines:
        if line.qty <= 0:
            raise HTTPException(400, "Quantity must be greater than zero")
        item = await db.get(FoodInventory, line.food_inventory_id)
        if not item:
            raise HTTPException(404, "One of the selected stock items was not found")
        item_master = (
            await db.execute(select(ItemMaster).where(ItemMaster.stock_type == "food", ItemMaster.stock_id == item.id))
        ).scalars().first()
        resolved.append((item, line.qty, item_master))
    return resolved


async def _write_waste_lines(db: AsyncSession, waste: WasteLog, resolved) -> None:
    for item, qty, item_master in resolved:
        db.add(WasteLogLine(waste_log_id=waste.id, food_inventory_id=item.id,
                            item_master_id=item_master.id if item_master else None, ingredient_name=item.name,
                            qty=qty, unit=item.unit, unit_cost=float(item.cost)))


async def _waste_snapshot(db: AsyncSession, w: WasteLog) -> dict:
    labels = await _cc_labels(db)
    lines = (await db.execute(select(WasteLogLine).where(WasteLogLine.waste_log_id == w.id))).scalars().all()
    return {"date": w.date.isoformat(), "cost_center": labels.get(w.cost_center_id), "reason": w.reason,
            "notes": w.notes, "lines": [{"item": l.ingredient_name, "qty": float(l.qty)} for l in lines]}


@router.get("/waste-log", response_model=list[WasteLogOut])
async def list_waste_log(db: AsyncSession = Depends(get_db), _user: User = Depends(kitchen_access)):
    rows = (await db.execute(select(WasteLog).order_by(WasteLog.date.desc(), WasteLog.code.desc()))).scalars().all()
    return await _waste_outs(db, list(rows))


@router.get("/waste-log/{waste_id}", response_model=WasteLogOut)
async def get_waste_log(waste_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(kitchen_access)):
    waste = await db.get(WasteLog, waste_id)
    if not waste:
        raise HTTPException(404, "Waste log not found")
    return (await _waste_outs(db, [waste]))[0]


@router.post("/waste-log", response_model=WasteLogOut, status_code=201)
async def create_waste_log(
    payload: WasteLogIn, db: AsyncSession = Depends(get_db), user: User = Depends(kitchen_access)
):
    resolved = await _validate_waste(db, payload)
    waste = WasteLog(
        code=await next_code(db, WasteLog, "WL", 1001), date=payload.date, cost_center_id=payload.cost_center_id,
        reason=payload.reason, notes=payload.notes, logged_by=user.id,
    )
    db.add(waste)
    await db.flush()
    await _write_waste_lines(db, waste, resolved)
    await audit.record(db, user, "waste_log", waste.id, waste.code, "create", to_status=workflow.DRAFT)
    await log_activity(db, user, "Created waste log", waste.code)
    await db.commit()
    return (await _waste_outs(db, [waste]))[0]


@router.put("/waste-log/{waste_id}", response_model=WasteLogOut)
async def update_waste_log(
    waste_id: uuid.UUID, payload: WasteLogIn, db: AsyncSession = Depends(get_db), user: User = Depends(kitchen_access)
):
    waste = await db.get(WasteLog, waste_id)
    if not waste:
        raise HTTPException(404, "Waste log not found")
    workflow.ensure_editable(waste, user)
    resolved = await _validate_waste(db, payload)
    before = await _waste_snapshot(db, waste)
    waste.date, waste.cost_center_id, waste.reason, waste.notes = (
        payload.date, payload.cost_center_id, payload.reason, payload.notes,
    )
    await db.execute(delete(WasteLogLine).where(WasteLogLine.waste_log_id == waste.id))
    await _write_waste_lines(db, waste, resolved)
    await db.flush()
    await audit.record(db, user, "waste_log", waste.id, waste.code, "edit",
                       changes={"before": before, "after": await _waste_snapshot(db, waste)})
    await db.commit()
    return (await _waste_outs(db, [waste]))[0]


@router.delete("/waste-log/{waste_id}", status_code=204)
async def delete_waste_log(
    waste_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(kitchen_access)
):
    waste = await db.get(WasteLog, waste_id)
    if not waste:
        raise HTTPException(404, "Waste log not found")
    workflow.ensure_editable(waste, user)
    await audit.record(db, user, "waste_log", waste.id, waste.code, "delete", from_status=waste.status)
    await db.delete(waste)
    await db.commit()


async def _post_waste(db: AsyncSession, waste: WasteLog, user: User) -> None:
    lines = (await db.execute(select(WasteLogLine).where(WasteLogLine.waste_log_id == waste.id))).scalars().all()
    if not lines:
        raise HTTPException(400, "Add at least one wasted item before submitting")
    for line in lines:
        if not line.food_inventory_id:
            raise HTTPException(400, f"'{line.ingredient_name}' is no longer in stock records")
        movements = await stock.post_out(
            db, stock_type="food", stock_id=line.food_inventory_id, cc_id=waste.cost_center_id, qty=float(line.qty),
            txn_type="WASTE", txn_id=waste.id, txn_code=waste.code, user=user,
        )
        line.unit_cost = stock.weighted_unit_cost(movements)


workflow.register(workflow.DocType("meal_log", "Meal log", MealLog, "kitchen", _post_meal_log, _unpost_meal_log))
workflow.register(workflow.DocType("stock_transfer", "Raw material transfer", StockTransfer, "kitchen", _post_transfer))
workflow.register(workflow.DocType("waste_log", "Waste log", WasteLog, "kitchen", _post_waste))

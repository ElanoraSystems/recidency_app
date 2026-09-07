import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_module
from app.crud.activity import log_activity
from app.db.session import get_db
from app.models.finance import ResidenceSettings
from app.models.kitchen import (
    ConsumptionLog,
    FoodInventory,
    MealLog,
    MenuOption,
    ProposedMenu,
    Recipe,
    RecipeIngredient,
    StockTransfer,
    StockTransferLine,
    WasteLog,
    WasteLogLine,
    WeeklyMealPlan,
    WeeklyMealPlanEntry,
)
from app.models.purchasing import ItemMaster, UnitOfMeasure
from app.models.user import User
from app.services import units as unit_conv
from app.services.pdf import logo_data_uri, render_pdf

router = APIRouter(prefix="/kitchen", tags=["kitchen"])
kitchen_access = require_module("kitchen")


# ---------------------------------------------------------------- recipes --
class RecipeIngredientIn(BaseModel):
    food_inventory_id: uuid.UUID | None = None
    # A sub-recipe used as an ingredient of this one — e.g. 300g of "Basic
    # Tomato Sauce" inside a pasta dish. Exactly one of food_inventory_id /
    # sub_recipe_id must be set (enforced below and by the DB check
    # constraint). qty for a sub-recipe ingredient is always grams of its
    # finished yield — Recipe.raw_yield_g/portion_size_g are gram-based
    # throughout, so no unit-override is needed here.
    sub_recipe_id: uuid.UUID | None = None
    qty: float
    yield_pct: float = 100
    # Optional: qty is expressed in a different (but compatible) unit than
    # the linked stock item's own unit, e.g. 250 g of something tracked in
    # kg. Null means "qty is already in the stock item's own unit". Only
    # valid for a stock ingredient, never a sub-recipe one.
    override_unit_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _check_exactly_one_source(self):
        if bool(self.food_inventory_id) == bool(self.sub_recipe_id):
            raise ValueError("Each ingredient must link to exactly one of a stock item or a sub-recipe")
        if self.sub_recipe_id and self.override_unit_id:
            raise ValueError("A sub-recipe ingredient is always measured in grams — it can't have a unit override")
        return self


class RecipeIngredientOut(BaseModel):
    food_inventory_id: uuid.UUID | None
    sub_recipe_id: uuid.UUID | None
    name: str
    unit: str
    qty: float
    cost_per_unit: float
    yield_pct: float
    line_cost: float
    override_unit_id: uuid.UUID | None


class RecipeIn(BaseModel):
    name: str
    category: str
    allergens: list[str] = []
    notes: str | None = None
    prep_loss_pct: float = 0
    raw_yield_g: float = 1000
    portion_size_g: float = 250
    cooking_method: str | None = None
    method: str | None = None
    ingredients: list[RecipeIngredientIn] = []


class RecipeCost(BaseModel):
    total_cost: float
    final_yield_g: float
    portions: int
    cost_per_portion: float


class RecipeOut(BaseModel):
    id: uuid.UUID
    name: str
    category: str
    allergens: list[str]
    notes: str | None
    prep_loss_pct: float
    raw_yield_g: float
    portion_size_g: float
    cooking_method: str | None
    method: str | None
    cost: RecipeCost
    ingredients: list[RecipeIngredientOut]


def _effective_yield_pct(yield_pct: float) -> float:
    return yield_pct if yield_pct and yield_pct > 0 else 100.0


def _ingredient_line_cost(qty: float, cost_per_unit: float, yield_pct: float) -> float:
    """As-purchased cost of this line: qty is the edible/usable amount the
    recipe needs, grossed up by yield_pct to account for trim/prep loss on
    that specific ingredient (e.g. peeling, bones, fat)."""
    return round(qty * cost_per_unit / (_effective_yield_pct(yield_pct) / 100), 3)


def compute_recipe_cost(recipe: Recipe, resolved: list[tuple[float, float, float]]) -> RecipeCost:
    """`resolved` is a list of (qty, cost_per_unit, yield_pct) — cost_per_unit
    always read live off FoodInventory.cost by the caller, never stored on
    the ingredient itself, so this always reflects the stock item's current
    moving-average cost."""
    total_cost = sum(_ingredient_line_cost(qty, cost_per_unit, yield_pct) for qty, cost_per_unit, yield_pct in resolved)
    raw_yield_g = float(recipe.raw_yield_g or 1000)
    loss_pct = float(recipe.prep_loss_pct or 0)
    portion_size_g = float(recipe.portion_size_g or 250)
    final_yield_g = round(raw_yield_g * (1 - loss_pct / 100))
    portions = max(1, round(final_yield_g / portion_size_g)) if portion_size_g else 1
    return RecipeCost(
        total_cost=round(total_cost, 3),
        final_yield_g=final_yield_g,
        portions=portions,
        cost_per_portion=round(total_cost / portions, 3) if portions else 0,
    )


async def _resolve_ingredient_stock(
    db: AsyncSession, ingredients: list[RecipeIngredient]
) -> dict[uuid.UUID, FoodInventory]:
    ids = [i.food_inventory_id for i in ingredients if i.food_inventory_id]
    if not ids:
        return {}
    rows = (await db.execute(select(FoodInventory).where(FoodInventory.id.in_(ids)))).scalars().all()
    return {row.id: row for row in rows}


async def _load_uom_map(
    db: AsyncSession, labels: set[str], ids: set[uuid.UUID]
) -> tuple[dict[str, UnitOfMeasure], dict[uuid.UUID, UnitOfMeasure]]:
    """Loads every UnitOfMeasure row needed to resolve a batch of
    ingredients' conversions in as few queries as possible — keyed both by
    label (to find the UOM matching a stock item's plain-string unit) and
    by id (to find an ingredient's chosen override_unit_id)."""
    by_label: dict[str, UnitOfMeasure] = {}
    by_id: dict[uuid.UUID, UnitOfMeasure] = {}
    if labels:
        for row in (await db.execute(select(UnitOfMeasure).where(UnitOfMeasure.label.in_(labels)))).scalars().all():
            by_label[row.label] = row
            by_id[row.id] = row
    missing_ids = ids - set(by_id)
    if missing_ids:
        for row in (await db.execute(select(UnitOfMeasure).where(UnitOfMeasure.id.in_(missing_ids)))).scalars().all():
            by_label[row.label] = row
            by_id[row.id] = row
    return by_label, by_id


def _resolve_ingredient_qty(
    ingredient: RecipeIngredient, stock: FoodInventory | None,
    uom_by_label: dict[str, UnitOfMeasure], uom_by_id: dict[uuid.UUID, UnitOfMeasure],
) -> tuple[float, str]:
    """Returns (qty converted into the stock item's own unit for costing
    math, the unit label to actually display — the override unit if one was
    chosen, since that's what the user typed the quantity in)."""
    qty = float(ingredient.qty)
    if not ingredient.override_unit_id or not stock:
        return qty, stock.unit if stock else "—"
    override_uom = uom_by_id.get(ingredient.override_unit_id)
    stock_uom = uom_by_label.get(stock.unit)
    if not override_uom:
        return qty, "—"
    if not stock_uom:
        return qty, override_uom.label
    try:
        return unit_conv.convert(qty, override_uom, stock_uom), override_uom.label
    except unit_conv.IncompatibleUnitsError:
        # Save-time validation (_validate_ingredients) is what actually
        # prevents this — degrade gracefully here rather than crash a read.
        return qty, override_uom.label


async def _resolve_recipe(
    db: AsyncSession, recipe: Recipe, visiting: frozenset[uuid.UUID] = frozenset()
) -> tuple[RecipeCost, list[RecipeIngredientOut]]:
    """Recursively resolves a recipe's cost and per-ingredient breakdown. A
    sub-recipe ingredient's cost-per-gram is its own (recursively resolved)
    total_cost / final_yield_g — so nested sub-recipes always reflect their
    own ingredients' current moving-average cost, all the way down.

    `visiting` is the set of recipe ids on the current path from the root —
    a defensive backstop against a cycle that shouldn't be reachable at all
    given save-time validation (_check_no_cycle), but this guards against
    stale data written before that check existed or edited directly in the
    DB, raising a clear error instead of recursing forever.
    """
    if recipe.id in visiting:
        raise HTTPException(400, f'Circular sub-recipe reference involving "{recipe.name}"')
    visiting = visiting | {recipe.id}

    ingredients = (
        await db.execute(select(RecipeIngredient).where(RecipeIngredient.recipe_id == recipe.id))
    ).scalars().all()
    stock_by_id = await _resolve_ingredient_stock(db, ingredients)
    stock_unit_labels = {s.unit for s in stock_by_id.values()}
    override_ids = {i.override_unit_id for i in ingredients if i.override_unit_id}
    uom_by_label, uom_by_id = await _load_uom_map(db, stock_unit_labels, override_ids)

    ingredient_outs = []
    resolved_for_cost = []
    for i in ingredients:
        yield_pct = float(i.yield_pct or 100)
        if i.sub_recipe_id:
            sub_recipe = await db.get(Recipe, i.sub_recipe_id)
            if not sub_recipe:
                raise HTTPException(400, "A linked sub-recipe is missing")
            sub_cost, _ = await _resolve_recipe(db, sub_recipe, visiting)
            name = sub_recipe.name
            cost_per_unit = (sub_cost.total_cost / sub_cost.final_yield_g) if sub_cost.final_yield_g else 0.0
            qty_in_stock_unit = float(i.qty)
            display_unit = "g"
        else:
            stock = stock_by_id.get(i.food_inventory_id)
            # A linked stock item can't actually be deleted (RESTRICT), but
            # guard anyway rather than crash on a stale/missing lookup.
            name = stock.name if stock else "Unknown item"
            cost_per_unit = float(stock.cost) if stock else 0.0
            qty_in_stock_unit, display_unit = _resolve_ingredient_qty(i, stock, uom_by_label, uom_by_id)
        line_cost = _ingredient_line_cost(qty_in_stock_unit, cost_per_unit, yield_pct)
        display_qty = float(i.qty)
        resolved_for_cost.append((qty_in_stock_unit, cost_per_unit, yield_pct))
        ingredient_outs.append(
            RecipeIngredientOut(
                food_inventory_id=i.food_inventory_id, sub_recipe_id=i.sub_recipe_id,
                name=name, unit=display_unit, qty=display_qty,
                # Cost per the unit actually shown (e.g. per gram, if that's
                # what was typed) — derived from line_cost so qty*cost_per_unit
                # always reconciles exactly to what's displayed, rather than
                # a separately-converted number that could round differently.
                cost_per_unit=round(line_cost / display_qty, 6) if display_qty else 0.0,
                yield_pct=yield_pct, line_cost=line_cost, override_unit_id=i.override_unit_id,
            )
        )

    return compute_recipe_cost(recipe, resolved_for_cost), ingredient_outs


async def _recipe_out(db: AsyncSession, recipe: Recipe) -> RecipeOut:
    cost, ingredient_outs = await _resolve_recipe(db, recipe)
    return RecipeOut(
        id=recipe.id,
        name=recipe.name,
        category=recipe.category,
        allergens=recipe.allergens or [],
        notes=recipe.notes,
        prep_loss_pct=float(recipe.prep_loss_pct or 0),
        raw_yield_g=float(recipe.raw_yield_g or 0),
        portion_size_g=float(recipe.portion_size_g or 0),
        cooking_method=recipe.cooking_method,
        method=recipe.method,
        ingredients=ingredient_outs,
        cost=cost,
    )


async def _check_no_cycle(
    db: AsyncSession, root_id: uuid.UUID | None, sub_recipe_id: uuid.UUID, visited: set[uuid.UUID] | None = None
) -> None:
    """Walks down from `sub_recipe_id` through its own sub-recipe
    ingredients, raising if `root_id` (the recipe currently being saved)
    is reachable — that would mean it includes itself, even indirectly.
    root_id is None on create: a brand-new recipe has no id yet, so nothing
    below it could possibly reference it back."""
    if root_id is None:
        return
    if sub_recipe_id == root_id:
        raise HTTPException(400, "A recipe can't include itself as a sub-recipe, even indirectly")
    visited = visited or set()
    if sub_recipe_id in visited:
        return
    visited.add(sub_recipe_id)
    children = (
        await db.execute(
            select(RecipeIngredient.sub_recipe_id).where(
                RecipeIngredient.recipe_id == sub_recipe_id, RecipeIngredient.sub_recipe_id.isnot(None)
            )
        )
    ).scalars().all()
    for child_id in children:
        await _check_no_cycle(db, root_id, child_id, visited)


async def _validate_ingredients(
    db: AsyncSession, ingredients: list[RecipeIngredientIn], recipe_id: uuid.UUID | None = None
) -> None:
    food_ids = {i.food_inventory_id for i in ingredients if i.food_inventory_id}
    stock_by_id: dict[uuid.UUID, FoodInventory] = {}
    if food_ids:
        stock_rows = (await db.execute(select(FoodInventory).where(FoodInventory.id.in_(food_ids)))).scalars().all()
        stock_by_id = {s.id: s for s in stock_rows}
        missing = food_ids - set(stock_by_id)
        if missing:
            raise HTTPException(400, f"Unknown stock item(s): {', '.join(str(m) for m in missing)}")

    sub_recipe_ids = {i.sub_recipe_id for i in ingredients if i.sub_recipe_id}
    if sub_recipe_ids:
        found = set(
            (await db.execute(select(Recipe.id).where(Recipe.id.in_(sub_recipe_ids)))).scalars().all()
        )
        missing_recipes = sub_recipe_ids - found
        if missing_recipes:
            raise HTTPException(400, f"Unknown sub-recipe(s): {', '.join(str(m) for m in missing_recipes)}")
        for sub_id in sub_recipe_ids:
            await _check_no_cycle(db, recipe_id, sub_id)

    override_ids = {i.override_unit_id for i in ingredients if i.override_unit_id}
    if not override_ids:
        return
    stock_unit_labels = {s.unit for s in stock_by_id.values()}
    uom_by_label, uom_by_id = await _load_uom_map(db, stock_unit_labels, override_ids)
    for i in ingredients:
        if not i.override_unit_id:
            continue
        stock = stock_by_id[i.food_inventory_id]
        override_uom = uom_by_id.get(i.override_unit_id)
        if not override_uom:
            raise HTTPException(400, "Unknown unit selected for an ingredient")
        stock_uom = uom_by_label.get(stock.unit)
        if not stock_uom:
            raise HTTPException(
                400,
                f'"{stock.name}" is tracked in "{stock.unit}", which has no matching Unit of '
                "Measure entry — add one in Settings before overriding its unit",
            )
        try:
            unit_conv.convert(1, override_uom, stock_uom)
        except unit_conv.IncompatibleUnitsError as e:
            raise HTTPException(400, str(e)) from e


async def _expand_consumption(
    db: AsyncSession, recipe: Recipe, scale: float, visiting: frozenset[uuid.UUID] = frozenset()
) -> list[tuple[FoodInventory, float]]:
    """Recursively expands a recipe into leaf FoodInventory consumption at
    the given scale (the fraction of this recipe's full authored batch —
    i.e. its raw_yield_g — actually used). Butler tracks no separate
    "prepared batch" stock for a sub-recipe, so using one as an ingredient
    means walking down into ITS ingredients (and so on) until real stock
    items are reached, exactly like the direct ingredients of the top-level
    recipe."""
    if recipe.id in visiting:
        raise HTTPException(400, f'Circular sub-recipe reference involving "{recipe.name}"')
    visiting = visiting | {recipe.id}

    ingredients = (
        await db.execute(select(RecipeIngredient).where(RecipeIngredient.recipe_id == recipe.id))
    ).scalars().all()
    stock_by_id = await _resolve_ingredient_stock(db, ingredients)
    stock_unit_labels = {s.unit for s in stock_by_id.values()}
    override_ids = {i.override_unit_id for i in ingredients if i.override_unit_id}
    uom_by_label, uom_by_id = await _load_uom_map(db, stock_unit_labels, override_ids)

    out: list[tuple[FoodInventory, float]] = []
    for i in ingredients:
        yield_frac = _effective_yield_pct(float(i.yield_pct or 100)) / 100
        if i.sub_recipe_id:
            sub_recipe = await db.get(Recipe, i.sub_recipe_id)
            if not sub_recipe:
                continue
            sub_final_yield_g = round(
                float(sub_recipe.raw_yield_g or 1000) * (1 - float(sub_recipe.prep_loss_pct or 0) / 100)
            )
            qty_g_needed = (float(i.qty) * scale) / yield_frac
            sub_scale = (qty_g_needed / sub_final_yield_g) if sub_final_yield_g else 0.0
            out.extend(await _expand_consumption(db, sub_recipe, sub_scale, visiting))
        else:
            stock = stock_by_id.get(i.food_inventory_id)
            if not stock:
                continue
            qty_in_stock_unit, _ = _resolve_ingredient_qty(i, stock, uom_by_label, uom_by_id)
            consumed = (qty_in_stock_unit * scale) / yield_frac
            out.append((stock, consumed))
    return out


@router.get("/recipes", response_model=list[RecipeOut])
async def list_recipes(db: AsyncSession = Depends(get_db), _user: User = Depends(kitchen_access)):
    result = await db.execute(select(Recipe).order_by(Recipe.name))
    return [await _recipe_out(db, r) for r in result.scalars().all()]


@router.get("/recipes/{recipe_id}", response_model=RecipeOut)
async def get_recipe(
    recipe_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(kitchen_access)
):
    recipe = await db.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(404, "Recipe not found")
    return await _recipe_out(db, recipe)


@router.post("/recipes", response_model=RecipeOut, status_code=201)
async def create_recipe(
    payload: RecipeIn, db: AsyncSession = Depends(get_db), user: User = Depends(kitchen_access)
):
    await _validate_ingredients(db, payload.ingredients, recipe_id=None)
    recipe = Recipe(
        name=payload.name,
        category=payload.category,
        allergens=payload.allergens,
        notes=payload.notes,
        prep_loss_pct=payload.prep_loss_pct,
        raw_yield_g=payload.raw_yield_g,
        portion_size_g=payload.portion_size_g,
        cooking_method=payload.cooking_method,
        method=payload.method,
    )
    db.add(recipe)
    await db.flush()
    for ing in payload.ingredients:
        db.add(RecipeIngredient(recipe_id=recipe.id, **ing.model_dump()))
    await log_activity(db, user, "Created recipe", recipe.name)
    await db.commit()
    await db.refresh(recipe)
    return await _recipe_out(db, recipe)


@router.patch("/recipes/{recipe_id}", response_model=RecipeOut)
async def update_recipe(
    recipe_id: uuid.UUID,
    payload: RecipeIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(kitchen_access),
):
    recipe = await db.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(404, "Recipe not found")
    await _validate_ingredients(db, payload.ingredients, recipe_id=recipe.id)
    for field in ("name", "category", "allergens", "notes", "prep_loss_pct", "raw_yield_g",
                  "portion_size_g", "cooking_method", "method"):
        setattr(recipe, field, getattr(payload, field))
    result = await db.execute(select(RecipeIngredient).where(RecipeIngredient.recipe_id == recipe.id))
    for existing in result.scalars().all():
        await db.delete(existing)
    await db.flush()
    for ing in payload.ingredients:
        db.add(RecipeIngredient(recipe_id=recipe.id, **ing.model_dump()))
    await db.commit()
    await db.refresh(recipe)
    return await _recipe_out(db, recipe)


@router.delete("/recipes/{recipe_id}", status_code=204)
async def delete_recipe(
    recipe_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(kitchen_access)
):
    recipe = await db.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(404, "Recipe not found")
    used_in = set(
        (
            await db.execute(
                select(RecipeIngredient.recipe_id).where(RecipeIngredient.sub_recipe_id == recipe_id)
            )
        ).scalars().all()
    )
    if used_in:
        raise HTTPException(
            400, f'"{recipe.name}" is used as a sub-recipe in {len(used_in)} other recipe(s) — remove it from them first'
        )
    await db.delete(recipe)
    await db.commit()


# --------------------------------------------------------------- meal log --
class MealLogIn(BaseModel):
    date: date
    category: str
    dish: str
    recipe_id: uuid.UUID | None = None
    qty: int
    notes: str | None = None
    produced_for: str | None = None


class MealLogOut(BaseModel):
    id: uuid.UUID
    date: date
    category: str
    dish: str
    recipe_id: uuid.UUID | None
    qty: int
    unit_cost: float
    notes: str | None
    produced_for: str | None

    class Config:
        from_attributes = True


@router.get("/meal-log", response_model=list[MealLogOut])
async def list_meal_log(db: AsyncSession = Depends(get_db), _user: User = Depends(kitchen_access)):
    result = await db.execute(select(MealLog).order_by(MealLog.date.desc()))
    return result.scalars().all()


@router.post("/meal-log", response_model=MealLogOut, status_code=201)
async def log_meal(
    payload: MealLogIn, db: AsyncSession = Depends(get_db), user: User = Depends(kitchen_access)
):
    """Logging a meal deducts recipe ingredients from food_inventory
    atomically in the same transaction, so meal log and stock can never
    drift apart (per the build plan, §03 and §07 phase-2 'done' criteria)."""
    unit_cost = 0.0
    recipe: Recipe | None = None
    recipe_cost = None
    if payload.recipe_id:
        recipe = await db.get(Recipe, payload.recipe_id)
        if not recipe:
            raise HTTPException(404, "Recipe not found")
        recipe_cost, _ = await _resolve_recipe(db, recipe)
        unit_cost = recipe_cost.cost_per_portion

    meal = MealLog(
        date=payload.date,
        category=payload.category,
        dish=payload.dish,
        recipe_id=payload.recipe_id,
        qty=payload.qty,
        unit_cost=unit_cost,
        logged_by=user.id,
        notes=payload.notes,
        produced_for=payload.produced_for,
    )
    db.add(meal)
    await db.flush()

    if recipe and recipe_cost:
        # Scale = fraction of the recipe's full authored batch (raw_yield_g)
        # actually served, e.g. 4 portions served out of a batch that yields
        # 10 => scale 0.4. Recursively expanding at this scale walks through
        # any sub-recipe ingredients down to real FoodInventory items —
        # Butler has no separate "prepared batch" stock for a sub-recipe, so
        # using one deducts its own raw ingredients directly, same as if
        # they'd been listed on the top-level recipe.
        scale = payload.qty / (recipe_cost.portions or 1)
        leaf_consumption = await _expand_consumption(db, recipe, scale)
        stock_by_id: dict[uuid.UUID, FoodInventory] = {}
        consumed_by_id: dict[uuid.UUID, float] = {}
        for stock, qty in leaf_consumption:
            stock_by_id[stock.id] = stock
            consumed_by_id[stock.id] = consumed_by_id.get(stock.id, 0.0) + qty
        for stock_id, consumed_qty in consumed_by_id.items():
            match = stock_by_id[stock_id]
            match.qty = max(0, float(match.qty) - consumed_qty)
            db.add(
                ConsumptionLog(
                    date=payload.date,
                    recipe_id=recipe.id,
                    dish=recipe.name,
                    meals_served=payload.qty,
                    ingredient=match.name,
                    qty_consumed=round(consumed_qty, 3),
                    unit=match.unit,
                    matched_stock_id=match.id,
                    meal_log_id=meal.id,
                )
            )
    await log_activity(db, user, "Logged meal served", f"{payload.dish} — {payload.qty} portions")
    await db.commit()
    await db.refresh(meal)
    return meal


@router.get("/consumption-log")
async def list_consumption_log(
    recipe_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(kitchen_access),
):
    stmt = select(ConsumptionLog).order_by(ConsumptionLog.date.desc()).limit(200)
    if recipe_id:
        stmt = stmt.where(ConsumptionLog.recipe_id == recipe_id)
    result = await db.execute(stmt)
    rows = result.scalars().all()
    return [
        {
            "id": r.id,
            "date": r.date,
            "recipe_id": r.recipe_id,
            "dish": r.dish,
            "meals_served": r.meals_served,
            "ingredient": r.ingredient,
            "qty_consumed": float(r.qty_consumed),
            "unit": r.unit,
        }
        for r in rows
    ]


# ---------------------------------------------------------- stock transfers --
class StockTransferLineIn(BaseModel):
    food_inventory_id: uuid.UUID
    qty: float


class StockTransferIn(BaseModel):
    date: date
    reason: str
    notes: str | None = None
    lines: list[StockTransferLineIn]


class StockTransferLineOut(BaseModel):
    id: uuid.UUID
    food_inventory_id: uuid.UUID | None
    ingredient_name: str
    qty: float
    unit: str

    class Config:
        from_attributes = True


class StockTransferOut(BaseModel):
    id: uuid.UUID
    date: date
    reason: str
    notes: str | None
    logged_by_name: str | None
    lines: list[StockTransferLineOut]


async def _transfer_out(db: AsyncSession, transfer: StockTransfer) -> StockTransferOut:
    lines = (
        await db.execute(select(StockTransferLine).where(StockTransferLine.transfer_id == transfer.id))
    ).scalars().all()
    logger = await db.get(User, transfer.logged_by) if transfer.logged_by else None
    return StockTransferOut(
        id=transfer.id,
        date=transfer.date,
        reason=transfer.reason,
        notes=transfer.notes,
        logged_by_name=logger.name if logger else None,
        lines=[StockTransferLineOut.model_validate(line) for line in lines],
    )


@router.get("/stock-transfers", response_model=list[StockTransferOut])
async def list_stock_transfers(db: AsyncSession = Depends(get_db), _user: User = Depends(kitchen_access)):
    result = await db.execute(select(StockTransfer).order_by(StockTransfer.date.desc()))
    return [await _transfer_out(db, t) for t in result.scalars().all()]


@router.post("/stock-transfers", response_model=StockTransferOut, status_code=201)
async def create_stock_transfer(
    payload: StockTransferIn, db: AsyncSession = Depends(get_db), user: User = Depends(kitchen_access)
):
    """Direct raw-material withdrawal, skipping the recipe step entirely —
    for when there's no time to build a recipe first. Deducts food_inventory
    the same way a recipe-based meal log does."""
    if not payload.lines:
        raise HTTPException(400, "Add at least one raw material line")

    transfer = StockTransfer(date=payload.date, reason=payload.reason, notes=payload.notes, logged_by=user.id)
    db.add(transfer)
    await db.flush()

    for line in payload.lines:
        if line.qty <= 0:
            raise HTTPException(400, "Quantity must be greater than zero")
        item = await db.get(FoodInventory, line.food_inventory_id)
        if not item:
            raise HTTPException(404, "One of the selected stock items was not found")
        item.qty = max(0, float(item.qty) - line.qty)
        db.add(
            StockTransferLine(
                transfer_id=transfer.id,
                food_inventory_id=item.id,
                ingredient_name=item.name,
                qty=line.qty,
                unit=item.unit,
            )
        )

    await log_activity(db, user, "Logged raw material transfer", f"{payload.reason} — {len(payload.lines)} item(s)")
    await db.commit()
    await db.refresh(transfer)
    return await _transfer_out(db, transfer)


# --------------------------------------------------------------- waste log --
class WasteLogLineIn(BaseModel):
    food_inventory_id: uuid.UUID
    qty: float


class WasteLogIn(BaseModel):
    date: date
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

    class Config:
        from_attributes = True


class WasteLogOut(BaseModel):
    id: uuid.UUID
    date: date
    reason: str
    notes: str | None
    status: str
    logged_by_name: str | None
    reviewed_by_name: str | None
    lines: list[WasteLogLineOut]


async def _waste_log_out(db: AsyncSession, waste: WasteLog) -> WasteLogOut:
    lines = (
        await db.execute(select(WasteLogLine).where(WasteLogLine.waste_log_id == waste.id))
    ).scalars().all()
    logger = await db.get(User, waste.logged_by) if waste.logged_by else None
    reviewer = await db.get(User, waste.reviewed_by) if waste.reviewed_by else None
    return WasteLogOut(
        id=waste.id,
        date=waste.date,
        reason=waste.reason,
        notes=waste.notes,
        status=waste.status,
        logged_by_name=logger.name if logger else None,
        reviewed_by_name=reviewer.name if reviewer else None,
        lines=[
            WasteLogLineOut(
                id=line.id, food_inventory_id=line.food_inventory_id, item_master_id=line.item_master_id,
                ingredient_name=line.ingredient_name, qty=float(line.qty), unit=line.unit,
                unit_cost=float(line.unit_cost), line_cost=round(float(line.qty) * float(line.unit_cost), 3),
            )
            for line in lines
        ],
    )


@router.get("/waste-log", response_model=list[WasteLogOut])
async def list_waste_log(db: AsyncSession = Depends(get_db), _user: User = Depends(kitchen_access)):
    result = await db.execute(select(WasteLog).order_by(WasteLog.date.desc()))
    return [await _waste_log_out(db, w) for w in result.scalars().all()]


@router.post("/waste-log", response_model=WasteLogOut, status_code=201)
async def log_waste(
    payload: WasteLogIn, db: AsyncSession = Depends(get_db), user: User = Depends(kitchen_access)
):
    """Logging waste deducts food_inventory immediately — the stock is
    physically spoiled/gone regardless of paperwork. The supervisor review
    that follows (see approvals.py's waste_log branch) is an audit step, not
    a gate, and never reverses this deduction."""
    if not payload.lines:
        raise HTTPException(400, "Add at least one wasted item")

    waste = WasteLog(date=payload.date, reason=payload.reason, notes=payload.notes, logged_by=user.id)
    db.add(waste)
    await db.flush()

    for line in payload.lines:
        if line.qty <= 0:
            raise HTTPException(400, "Quantity must be greater than zero")
        item = await db.get(FoodInventory, line.food_inventory_id)
        if not item:
            raise HTTPException(404, "One of the selected stock items was not found")
        item.qty = max(0, float(item.qty) - line.qty)
        item_master = (
            await db.execute(
                select(ItemMaster).where(
                    ItemMaster.stock_type == "food", ItemMaster.stock_id == item.id
                )
            )
        ).scalars().first()
        db.add(
            WasteLogLine(
                waste_log_id=waste.id,
                food_inventory_id=item.id,
                item_master_id=item_master.id if item_master else None,
                ingredient_name=item.name,
                qty=line.qty,
                unit=item.unit,
                unit_cost=float(item.cost),
            )
        )

    await log_activity(db, user, "Logged kitchen waste", f"{payload.reason} — {len(payload.lines)} item(s)")
    await db.commit()
    await db.refresh(waste)
    return await _waste_log_out(db, waste)


async def _residence_pdf_context(db: AsyncSession) -> dict:
    residence = (await db.execute(select(ResidenceSettings).limit(1))).scalar_one_or_none()
    return {
        "residence": {
            "name": residence.name if residence else "Residence",
            "address": residence.address if residence else None,
            "phone": residence.phone if residence else None,
        },
        "currency": residence.currency if residence else "KWD",
        "logo_data_uri": logo_data_uri(residence.logo_path) if residence else None,
    }


@router.get("/meal-log/{meal_id}/invoice-pdf")
async def meal_log_invoice_pdf(
    meal_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(kitchen_access)
):
    meal = await db.get(MealLog, meal_id)
    if not meal:
        raise HTTPException(404, "Meal log entry not found")
    total = float(meal.unit_cost) * meal.qty
    pdf_bytes = render_pdf(
        "invoice.html",
        {
            **await _residence_pdf_context(db),
            "title": meal.dish,
            "subtitle": meal.produced_for or meal.category,
            "date": meal.date.isoformat(),
            "line_items": [
                {"name": meal.dish, "qty": float(meal.qty), "unit": "portions",
                 "unit_cost": float(meal.unit_cost), "line_total": total}
            ],
            "total": total,
        },
    )
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="meal-log-{meal.id}.pdf"'},
    )


@router.get("/stock-transfers/{transfer_id}/invoice-pdf")
async def stock_transfer_invoice_pdf(
    transfer_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(kitchen_access)
):
    transfer = await db.get(StockTransfer, transfer_id)
    if not transfer:
        raise HTTPException(404, "Stock transfer not found")
    lines = (
        await db.execute(select(StockTransferLine).where(StockTransferLine.transfer_id == transfer.id))
    ).scalars().all()
    line_items = []
    total = 0.0
    for line in lines:
        # StockTransferLine has no stored cost — derive it from the current
        # FoodInventory.cost, falling back to 0 if the stock link was since
        # nulled out (the same SET NULL scenario the transfer itself tolerates).
        unit_cost = 0.0
        if line.food_inventory_id:
            item = await db.get(FoodInventory, line.food_inventory_id)
            if item:
                unit_cost = float(item.cost)
        line_total = float(line.qty) * unit_cost
        total += line_total
        line_items.append(
            {"name": line.ingredient_name, "qty": float(line.qty), "unit": line.unit,
             "unit_cost": unit_cost, "line_total": line_total}
        )
    pdf_bytes = render_pdf(
        "invoice.html",
        {
            **await _residence_pdf_context(db),
            "title": f"Raw material transfer — {transfer.reason}",
            "subtitle": transfer.reason,
            "date": transfer.date.isoformat(),
            "line_items": line_items,
            "total": total,
        },
    )
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="stock-transfer-{transfer.id}.pdf"'},
    )


# ------------------------------------------------------ weekly meal plans --
OCCASION_TYPES_STAFF = {"Staff Meals – Office", "Staff Meals – Residence"}
VALID_DAYS = {"sun", "mon", "tue", "wed", "thu", "fri", "sat"}
VALID_MEAL_TYPES = {"breakfast", "lunch", "dinner"}


class WeeklyMealPlanIn(BaseModel):
    occasion_type: str
    week_start_date: date
    notes: str | None = None


class WeeklyMealPlanEntryIn(BaseModel):
    day_of_week: str
    meal_type: str
    recipe_id: uuid.UUID | None = None
    custom_meal_name: str | None = None


class WeeklyMealPlanEntryOut(BaseModel):
    id: uuid.UUID
    day_of_week: str
    meal_type: str
    recipe_id: uuid.UUID | None
    custom_meal_name: str | None

    class Config:
        from_attributes = True


class WeeklyMealPlanOut(BaseModel):
    id: uuid.UUID
    occasion_type: str
    week_start_date: date
    status: str
    notes: str | None
    created_by_name: str | None
    entries: list[WeeklyMealPlanEntryOut]


async def _plan_out(db: AsyncSession, plan: WeeklyMealPlan) -> WeeklyMealPlanOut:
    entries = (
        await db.execute(select(WeeklyMealPlanEntry).where(WeeklyMealPlanEntry.plan_id == plan.id))
    ).scalars().all()
    creator = await db.get(User, plan.created_by) if plan.created_by else None
    return WeeklyMealPlanOut(
        id=plan.id,
        occasion_type=plan.occasion_type,
        week_start_date=plan.week_start_date,
        status=plan.status,
        notes=plan.notes,
        created_by_name=creator.name if creator else None,
        entries=[WeeklyMealPlanEntryOut.model_validate(e) for e in entries],
    )


@router.get("/weekly-meal-plans", response_model=list[WeeklyMealPlanOut])
async def list_weekly_meal_plans(db: AsyncSession = Depends(get_db), _user: User = Depends(kitchen_access)):
    result = await db.execute(select(WeeklyMealPlan).order_by(WeeklyMealPlan.week_start_date.desc()))
    return [await _plan_out(db, p) for p in result.scalars().all()]


@router.post("/weekly-meal-plans", response_model=WeeklyMealPlanOut, status_code=201)
async def create_weekly_meal_plan(
    payload: WeeklyMealPlanIn, db: AsyncSession = Depends(get_db), user: User = Depends(kitchen_access)
):
    if payload.occasion_type not in OCCASION_TYPES_STAFF:
        raise HTTPException(400, f"Unknown occasion type '{payload.occasion_type}'")
    plan = WeeklyMealPlan(
        occasion_type=payload.occasion_type,
        week_start_date=payload.week_start_date,
        notes=payload.notes,
        created_by=user.id,
    )
    db.add(plan)
    await log_activity(db, user, "Started weekly meal plan", f"{payload.occasion_type} — week of {payload.week_start_date}")
    await db.commit()
    await db.refresh(plan)
    return await _plan_out(db, plan)


@router.put("/weekly-meal-plans/{plan_id}/cell", response_model=WeeklyMealPlanOut)
async def set_weekly_meal_plan_cell(
    plan_id: uuid.UUID,
    payload: WeeklyMealPlanEntryIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(kitchen_access),
):
    plan = await db.get(WeeklyMealPlan, plan_id)
    if not plan:
        raise HTTPException(404, "Weekly meal plan not found")
    if plan.status not in ("Draft",):
        raise HTTPException(400, "This plan is awaiting approval or already approved — it can't be edited")
    if payload.day_of_week not in VALID_DAYS:
        raise HTTPException(400, f"Unknown day '{payload.day_of_week}'")
    if payload.meal_type not in VALID_MEAL_TYPES:
        raise HTTPException(400, f"Unknown meal type '{payload.meal_type}'")
    if not payload.recipe_id and not (payload.custom_meal_name or "").strip():
        raise HTTPException(400, "Pick a recipe or type a custom meal name")

    existing = (
        await db.execute(
            select(WeeklyMealPlanEntry).where(
                WeeklyMealPlanEntry.plan_id == plan_id,
                WeeklyMealPlanEntry.day_of_week == payload.day_of_week,
                WeeklyMealPlanEntry.meal_type == payload.meal_type,
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.recipe_id = payload.recipe_id
        existing.custom_meal_name = payload.custom_meal_name
    else:
        db.add(
            WeeklyMealPlanEntry(
                plan_id=plan_id,
                day_of_week=payload.day_of_week,
                meal_type=payload.meal_type,
                recipe_id=payload.recipe_id,
                custom_meal_name=payload.custom_meal_name,
            )
        )
    await db.commit()
    await db.refresh(plan)
    return await _plan_out(db, plan)


@router.post("/weekly-meal-plans/{plan_id}/submit", response_model=WeeklyMealPlanOut)
async def submit_weekly_meal_plan(
    plan_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(kitchen_access)
):
    plan = await db.get(WeeklyMealPlan, plan_id)
    if not plan:
        raise HTTPException(404, "Weekly meal plan not found")
    if plan.status != "Draft":
        raise HTTPException(400, "Only a draft plan can be submitted for approval")
    count = (
        await db.execute(select(WeeklyMealPlanEntry).where(WeeklyMealPlanEntry.plan_id == plan_id))
    ).scalars().all()
    if not count:
        raise HTTPException(400, "Fill in at least one meal before submitting")
    plan.status = "Pending Approval"
    await log_activity(db, user, "Submitted weekly meal plan for approval", f"{plan.occasion_type} — week of {plan.week_start_date}")
    await db.commit()
    await db.refresh(plan)
    return await _plan_out(db, plan)


@router.delete("/weekly-meal-plans/{plan_id}", status_code=204)
async def delete_weekly_meal_plan(
    plan_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(kitchen_access)
):
    plan = await db.get(WeeklyMealPlan, plan_id)
    if not plan:
        raise HTTPException(404, "Weekly meal plan not found")
    if plan.status != "Draft":
        raise HTTPException(400, "Only a draft plan can be deleted — submitted or approved weeks are kept for the record")
    await log_activity(db, user, "Deleted weekly meal plan draft", f"{plan.occasion_type} — week of {plan.week_start_date}")
    await db.delete(plan)
    await db.commit()


# ---------------------------------------------------------- proposed menus --
class MenuOptionIn(BaseModel):
    recipe_id: uuid.UUID
    note: str | None = None
    selected: bool = False


class ProposedMenuIn(BaseModel):
    occasion: str
    occasion_type: str
    for_date: date
    category: str
    notes: str | None = None
    options: list[MenuOptionIn] = []


class ProposedMenuOut(ProposedMenuIn):
    id: uuid.UUID
    status: str
    created_by_name: str | None = None


async def _menu_out(db: AsyncSession, menu: ProposedMenu) -> ProposedMenuOut:
    result = await db.execute(select(MenuOption).where(MenuOption.proposed_menu_id == menu.id))
    options = result.scalars().all()
    creator = await db.get(User, menu.created_by) if menu.created_by else None
    return ProposedMenuOut(
        id=menu.id,
        occasion=menu.occasion,
        occasion_type=menu.occasion_type,
        for_date=menu.for_date,
        category=menu.category,
        notes=menu.notes,
        status=menu.status,
        created_by_name=creator.name if creator else None,
        options=[
            MenuOptionIn(recipe_id=o.recipe_id, note=o.note, selected=o.selected) for o in options
        ],
    )


@router.get("/proposed-menus", response_model=list[ProposedMenuOut])
async def list_proposed_menus(db: AsyncSession = Depends(get_db), _user: User = Depends(kitchen_access)):
    result = await db.execute(select(ProposedMenu).order_by(ProposedMenu.for_date))
    return [await _menu_out(db, m) for m in result.scalars().all()]


@router.post("/proposed-menus", response_model=ProposedMenuOut, status_code=201)
async def create_proposed_menu(
    payload: ProposedMenuIn, db: AsyncSession = Depends(get_db), user: User = Depends(kitchen_access)
):
    menu = ProposedMenu(
        occasion=payload.occasion,
        occasion_type=payload.occasion_type,
        for_date=payload.for_date,
        category=payload.category,
        notes=payload.notes,
        created_by=user.id,
    )
    db.add(menu)
    await db.flush()
    for opt in payload.options:
        db.add(MenuOption(proposed_menu_id=menu.id, **opt.model_dump()))
    await log_activity(db, user, "Submitted menu proposal", payload.occasion)
    await db.commit()
    await db.refresh(menu)
    return await _menu_out(db, menu)


@router.post("/proposed-menus/{menu_id}/decision", response_model=ProposedMenuOut)
async def decide_proposed_menu(
    menu_id: uuid.UUID,
    approve: bool,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(kitchen_access),
):
    menu = await db.get(ProposedMenu, menu_id)
    if not menu:
        raise HTTPException(404, "Proposed menu not found")
    menu.status = "Approved" if approve else "Rejected"
    await log_activity(db, user, f"{menu.status} menu proposal", menu.occasion)
    await db.commit()
    await db.refresh(menu)
    return await _menu_out(db, menu)

"""What a set of dishes needs from stock, and whether there is enough.

POST /kitchen/needs takes (recipe, portions) pairs and returns the raw
ingredients they use in each stock item's own unit, next to what is on hand
(overall, or at one cost center), plus the sub-recipes to prepare. The recipe
page, the day board, the weekly plan and meal logging all share it, so every
"enough for N portions" and "short by" figure comes from one calculation.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.kitchen import (
    _effective_yield_pct,
    _load_uom_map,
    _resolve_ingredient_qty,
    _resolve_ingredient_stock,
    compute_recipe_cost,
    kitchen_access,
)
from app.db.session import get_db
from app.models.kitchen import FoodInventory, Recipe, RecipeIngredient
from app.models.purchasing import ItemMaster
from app.models.user import User
from app.services import stock as stock_service

router = APIRouter(prefix="/kitchen", tags=["kitchen"])


class NeedItem(BaseModel):
    recipe_id: uuid.UUID
    portions: float = Field(gt=0)


class NeedsIn(BaseModel):
    items: list[NeedItem] = Field(min_length=1)
    # Count only stock held at this cost center (e.g. where a meal is logged).
    cost_center_id: uuid.UUID | None = None


class NeedLine(BaseModel):
    food_inventory_id: uuid.UUID
    item_master_id: uuid.UUID | None
    name: str
    unit: str
    needed: float
    have: float
    short: float  # 0 when there is enough


class PrepLine(BaseModel):
    recipe_id: uuid.UUID
    name: str
    grams: float


class NeedsOut(BaseModel):
    lines: list[NeedLine]
    prep: list[PrepLine]
    # Only for a single dish: how many portions the stock on hand would make.
    max_portions: int | None


async def _explode(
    db: AsyncSession, recipe: Recipe, factor: float, need: dict[uuid.UUID, float], prep: dict[uuid.UUID, float],
    uoms: tuple, visiting: frozenset[uuid.UUID] = frozenset(),
) -> None:
    """Adds the stock a recipe uses (scaled by `factor` of one batch) to `need`,
    walking down through sub-recipes."""
    if recipe.id in visiting:
        raise HTTPException(400, f'Circular sub-recipe reference involving "{recipe.name}"')
    visiting = visiting | {recipe.id}
    ingredients = (await db.execute(select(RecipeIngredient).where(RecipeIngredient.recipe_id == recipe.id))).scalars().all()
    stock_by_id = await _resolve_ingredient_stock(db, ingredients)
    uom_by_label, uom_by_id = uoms
    for i in ingredients:
        gross = factor / (_effective_yield_pct(float(i.yield_pct or 100)) / 100)
        if i.sub_recipe_id:
            sub = await db.get(Recipe, i.sub_recipe_id)
            if not sub:
                continue
            grams = float(i.qty) * gross  # a sub-recipe quantity is grams of its finished yield
            prep[sub.id] = prep.get(sub.id, 0.0) + grams
            sub_yield = compute_recipe_cost(sub, []).final_yield_g
            if sub_yield:
                await _explode(db, sub, grams / sub_yield, need, prep, uoms, visiting)
        elif i.food_inventory_id and (stock := stock_by_id.get(i.food_inventory_id)):
            qty, _unit = _resolve_ingredient_qty(i, stock, uom_by_label, uom_by_id)
            need[stock.id] = need.get(stock.id, 0.0) + qty * gross


@router.post("/needs", response_model=NeedsOut)
async def needs(payload: NeedsIn, db: AsyncSession = Depends(get_db), _user: User = Depends(kitchen_access)):
    uoms = await _load_uom_map(db)
    need: dict[uuid.UUID, float] = {}
    prep: dict[uuid.UUID, float] = {}
    per_portion: dict[uuid.UUID, float] = {}
    for item in payload.items:
        recipe = await db.get(Recipe, item.recipe_id)
        if not recipe:
            raise HTTPException(404, "Recipe not found")
        recipe_portions = compute_recipe_cost(recipe, []).portions
        before = dict(need)
        await _explode(db, recipe, item.portions / recipe_portions, need, prep, uoms)
        if len(payload.items) == 1:
            per_portion = {k: (v - before.get(k, 0.0)) / item.portions for k, v in need.items()}

    ids = list(need)
    foods = {f.id: f for f in (await db.execute(select(FoodInventory).where(FoodInventory.id.in_(ids)))).scalars().all()} if ids else {}
    if payload.cost_center_id:
        have = {
            row["stock_id"]: row["qty"]
            for row in await stock_service.location_balances(db, "food", payload.cost_center_id)
        }
    else:
        have = {fid: float(f.qty) for fid, f in foods.items()}
    masters = (
        dict((await db.execute(select(ItemMaster.stock_id, ItemMaster.id).where(ItemMaster.stock_type == "food", ItemMaster.stock_id.in_(ids)))).all())
        if ids else {}
    )
    lines = []
    for fid, qty in need.items():
        food = foods.get(fid)
        if not food or qty <= 0:
            continue
        on_hand = max(0.0, have.get(fid, 0.0))
        lines.append(NeedLine(
            food_inventory_id=fid, item_master_id=masters.get(fid), name=food.name, unit=food.unit,
            needed=round(qty, 3), have=round(on_hand, 3), short=round(max(0.0, qty - on_hand), 3),
        ))
    lines.sort(key=lambda l: (-(l.short > 0), l.name.lower()))

    max_portions = None
    if len(payload.items) == 1 and per_portion:
        limits = [max(0.0, have.get(fid, 0.0)) / pp for fid, pp in per_portion.items() if pp > 0]
        max_portions = int(min(limits)) if limits else None
    recipes = {r.id: r for r in (await db.execute(select(Recipe).where(Recipe.id.in_(list(prep))))).scalars().all()} if prep else {}
    prep_lines = [PrepLine(recipe_id=rid, name=recipes[rid].name, grams=round(g)) for rid, g in prep.items() if rid in recipes]
    prep_lines.sort(key=lambda p: p.name.lower())
    return NeedsOut(lines=lines, prep=prep_lines, max_portions=max_portions)

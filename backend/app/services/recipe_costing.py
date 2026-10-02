"""Recipe cost history. A recipe's cost is always computed from its
ingredients' current stock cost, so it moves as purchase prices move; these
snapshots record what it was at each change."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.kitchen import Recipe, RecipeIngredient
from app.models.stock import RecipeCostSnapshot


async def snapshot_recipe(db: AsyncSession, recipe: Recipe, reason: str) -> None:
    from app.api.v1.kitchen import _resolve_recipe  # lazy: that module imports the stock engine

    cost, _ = await _resolve_recipe(db, recipe)
    last = (
        await db.execute(
            select(RecipeCostSnapshot)
            .where(RecipeCostSnapshot.recipe_id == recipe.id)
            .order_by(RecipeCostSnapshot.created_at.desc(), RecipeCostSnapshot.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if last and abs(float(last.cost_per_portion) - cost.cost_per_portion) < 0.0005 and abs(float(last.total_cost) - cost.total_cost) < 0.0005:
        return
    db.add(
        RecipeCostSnapshot(
            recipe_id=recipe.id, total_cost=cost.total_cost, cost_per_portion=cost.cost_per_portion,
            portions=cost.portions, reason=reason,
        )
    )


async def snapshot_for_food(db: AsyncSession, food_id: uuid.UUID, reason: str) -> None:
    """Snapshots every recipe that uses this stock item, directly or through
    a sub-recipe."""
    ids = set(
        (
            await db.execute(select(RecipeIngredient.recipe_id).where(RecipeIngredient.food_inventory_id == food_id))
        ).scalars().all()
    )
    frontier = set(ids)
    while frontier:
        parents = set(
            (
                await db.execute(select(RecipeIngredient.recipe_id).where(RecipeIngredient.sub_recipe_id.in_(frontier)))
            ).scalars().all()
        )
        frontier = parents - ids
        ids |= parents
    if not ids:
        return
    for recipe in (await db.execute(select(Recipe).where(Recipe.id.in_(ids)))).scalars().all():
        await snapshot_recipe(db, recipe, reason)

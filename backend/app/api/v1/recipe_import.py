"""Owner-only bulk import of recipes from a JSON file.

POST /kitchen/recipes/import?dry_run=true previews exactly what would happen
(everything is really executed, then rolled back); dry_run=false keeps it.

File format:
  {"recipes": [{
      "name", "category", "cooking_method", "method", "notes", "allergens": [],
      "portions": 8, "portion_size_g": 12 (optional), "yield_g": 600 (optional),
      "ingredients": [
         {"item": "Unsalted butter", "qty": 250, "unit": "g", "yield_pct": 100},
         {"recipe": "Tangzhong", "qty": 300}            # sub-recipe, grams
      ]}]}

Stock items are matched by name (case-insensitive); missing ones are created
(with an Item Master entry) at zero quantity and zero cost. Recipes that
already exist by name are skipped, so the import can be run again safely."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.kitchen import (
    RecipeIngredientIn,
    _compute_raw_yield_g,
    _load_uom_map,
    _validate_ingredients,
)
from app.crud.activity import log_activity
from app.db.session import get_db
from app.models.kitchen import FoodInventory, Recipe, RecipeIngredient
from app.models.purchasing import ItemMaster
from app.models.user import User
from app.services.recipe_costing import snapshot_recipe

router = APIRouter(prefix="/kitchen/recipes", tags=["kitchen"])

MASS, VOLUME, COUNT = "mass", "volume", "count"
FAMILY = {"g": MASS, "kg": MASS, "ml": VOLUME, "l": VOLUME}
STOCK_UNIT = {MASS: "kg", VOLUME: "L", COUNT: "units"}
# Crossing between mass and volume assumes water-like density (1 g = 1 ml);
# the report lists every place that assumption was used.
CROSS = {"g": "ml", "kg": "L", "ml": "g", "l": "kg"}


def _family(unit: str) -> str:
    return FAMILY.get(unit.lower(), COUNT)


async def _next_item_code(db: AsyncSession) -> str:
    last = (
        await db.execute(
            select(ItemMaster.code).where(ItemMaster.code.like("ITM-%")).order_by(ItemMaster.code.desc()).limit(1)
        )
    ).scalar_one_or_none()
    try:
        return f"ITM-{int(last.split('-')[1]) + 1}" if last else "ITM-1001"
    except (IndexError, ValueError):
        return "ITM-1001"


@router.post("/import")
async def import_recipes(
    payload: dict,
    dry_run: bool = True,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.user_type != "owner":
        raise HTTPException(403, "Only the owner (Super User) can import recipes")
    recipes = payload.get("recipes")
    if not isinstance(recipes, list) or not recipes:
        raise HTTPException(400, 'The file must look like {"recipes": [ ... ]}')
    names = [str(r.get("name", "")).strip() for r in recipes]
    if any(not n for n in names) or len({n.lower() for n in names}) != len(names):
        raise HTTPException(400, "Every recipe needs a unique name")

    uom_by_label, _ = await _load_uom_map(db)
    stock = {f.name.lower(): f for f in (await db.execute(select(FoodInventory))).scalars().all()}
    existing = {r.name.lower(): r for r in (await db.execute(select(Recipe))).scalars().all()}
    created_stock: set[str] = set()  # made during this import; not "existing" stock
    report: dict = {
        "dry_run": dry_run, "created": [], "skipped_existing": [], "errors": [],
        "new_stock_items": [], "matched_stock_items": set(), "assumptions": [],
    }

    # Sub-recipes first: order by dependencies.
    by_name = {r["name"].strip().lower(): r for r in recipes}
    order: list[dict] = []
    state: dict[str, int] = {}

    def visit(recipe: dict, chain: tuple[str, ...] = ()) -> None:
        key = recipe["name"].strip().lower()
        if state.get(key) == 2:
            return
        if state.get(key) == 1:
            raise HTTPException(400, f"Circular sub-recipe reference: {' > '.join(chain + (recipe['name'],))}")
        state[key] = 1
        for line in recipe.get("ingredients", []):
            sub = by_name.get(str(line.get("recipe", "")).strip().lower())
            if sub:
                visit(sub, chain + (recipe["name"],))
        state[key] = 2
        order.append(recipe)

    for recipe in recipes:
        visit(recipe)

    for spec in order:
        name = spec["name"].strip()
        if name.lower() in existing:
            report["skipped_existing"].append(name)
            continue
        try:
            lines = []
            for line in spec.get("ingredients", []):
                qty = float(line["qty"])
                if qty <= 0:
                    raise ValueError(f"quantity for {line.get('item') or line.get('recipe')} must be above zero")
                if "recipe" in line:
                    sub = existing.get(line["recipe"].strip().lower())
                    if sub is None:
                        raise ValueError(f"sub-recipe '{line['recipe']}' is not available")
                    lines.append(RecipeIngredientIn(sub_recipe_id=sub.id, qty=qty, yield_pct=line.get("yield_pct", 100)))
                    continue
                unit = str(line["unit"]).strip()
                item_name = str(line["item"]).strip()
                item = stock.get(item_name.lower())
                if item is None:
                    stock_unit = STOCK_UNIT[_family(unit)]
                    item = FoodInventory(name=item_name, category="Ingredients", qty=0, unit=stock_unit, cost=0)
                    db.add(item)
                    await db.flush()
                    db.add(
                        ItemMaster(
                            name=item_name, code=await _next_item_code(db), uom=stock_unit, last_price=0, active=True,
                            stock_type="food", stock_id=item.id, created_by=user.id,
                        )
                    )
                    await db.flush()
                    stock[item_name.lower()] = item
                    created_stock.add(item_name.lower())
                    report["new_stock_items"].append({"name": item_name, "unit": stock_unit})
                elif item_name.lower() not in created_stock:
                    report["matched_stock_items"].add(item.name)
                use_unit = unit
                fam_item, fam_line = _family(item.unit), _family(unit)
                if fam_item != fam_line:
                    if COUNT in (fam_item, fam_line):
                        raise ValueError(f"'{item_name}' is stocked in {item.unit} but the recipe uses {unit}")
                    use_unit = CROSS[unit.lower()]
                    report["assumptions"].append(
                        f"{name}: {item_name} {line['qty']} {unit} read as {line['qty']} {use_unit} (stocked in {item.unit}; 1 g = 1 ml)"
                    )
                override = None
                if use_unit.lower() != item.unit.lower() and fam_item != COUNT:
                    uom = uom_by_label.get(use_unit.lower())
                    if uom is None:
                        raise ValueError(f"unit '{use_unit}' is not in the units list")
                    override = uom.id
                lines.append(
                    RecipeIngredientIn(
                        food_inventory_id=item.id, qty=qty, yield_pct=line.get("yield_pct", 100), override_unit_id=override
                    )
                )
            if not lines:
                raise ValueError("a recipe needs at least one costed ingredient")
            await _validate_ingredients(db, lines, recipe_id=None)
            raw_yield = await _compute_raw_yield_g(db, lines)
            loss = 0.0
            if spec.get("yield_g") and raw_yield > 0:
                loss = max(0.0, min(100.0, round((1 - float(spec["yield_g"]) / raw_yield) * 100, 2)))
            def text(value):  # a list of steps/paragraphs is joined one per line
                return "\n".join(value) if isinstance(value, list) else value

            recipe = Recipe(
                name=name, category=spec.get("category") or "Special Meals", allergens=spec.get("allergens", []),
                notes=text(spec.get("notes")), prep_loss_pct=loss, raw_yield_g=raw_yield, portions=int(spec["portions"]),
                portion_size_g=spec.get("portion_size_g"), cooking_method=spec.get("cooking_method"),
                method=text(spec.get("method")),
            )
            db.add(recipe)
            await db.flush()
            for ing in lines:
                db.add(RecipeIngredient(recipe_id=recipe.id, **ing.model_dump()))
            await db.flush()
            await snapshot_recipe(db, recipe, "Imported")
            existing[name.lower()] = recipe
            report["created"].append(name)
        except (ValueError, KeyError, HTTPException) as err:
            detail = err.detail if isinstance(err, HTTPException) else f"missing or invalid field {err}" if isinstance(err, KeyError) else str(err)
            report["errors"].append({"recipe": name, "message": str(detail)})

    report["matched_stock_items"] = sorted(report["matched_stock_items"])
    if dry_run:
        await db.rollback()
    else:
        await log_activity(db, user, "Imported recipes", f"{len(report['created'])} created")
        await db.commit()
    return report

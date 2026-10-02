"""Seeds ~3 months of realistic Kitchen-module activity: a fuller pantry,
real recipe ingredient lists (replacing leftover test-data ingredients on
Chicken Curry / Pasta Spaghetti / Prawns Curry), a day-by-day history of
supplier restocks (real PR -> PO -> GRN -> batch chain), meals served
(real recipe costing + FEFO consumption), occasional waste, and Kitchen-
only tasks for the chef. Reuses the same business logic the live API uses
(app.api.v1.kitchen / app.api.v1.purchasing helpers) rather than
re-deriving it, so the seeded data behaves exactly like real usage would.

Run with:  ./venv/bin/python -m app.seed_kitchen_history
"""
import asyncio
import random
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select

from app.core.clock import local_today
from app.api.v1.kitchen import (
    RecipeIngredientIn,
    _compute_raw_yield_g,
    _expand_consumption,
    _resolve_recipe,
)
from app.api.v1.purchasing import _next_code
from app.db.session import AsyncSessionLocal
from app.models.finance import Expense
from app.models.kitchen import (
    ConsumptionLog,
    CostCenter,
    FoodInventory,
    MealCategory,
    MealLog,
    MealLogLine,
    Recipe,
    RecipeIngredient,
    StockTransfer,
    StockTransferLine,
    WasteLog,
    WasteLogLine,
)
from app.models.people import StaffProfile
from app.models.purchasing import (
    Grn, GrnLine, ItemMaster, PoLine, PurchaseOrder, PurchaseRequest, PurchaseRequestLine, Supplier,
)
from app.models.tasks import Task, TaskChecklistItem
from app.models.user import User
from app.services import stock as stock_service
from app.services.codes import next_code

random.seed(7)

MAIN_STORE = "Main Store"
# Destinations the simulated raw-material transfers move stock to.
TRANSFER_TARGETS = ["Staff", "Guests", "Events"]
LOCATIONS: dict[str, CostCenter] = {}


def _at(day: int) -> datetime:
    """Backdates a simulated movement to noon on its day."""
    return datetime.combine(D(day), time(12, 0), tzinfo=timezone.utc)


def _stamp(doc, user: User, day: int) -> None:
    """Simulated history is already signed off: Draft -> ... -> Closed."""
    when = _at(day)
    doc.status = "Closed"
    doc.submitted_by = doc.approved_by = doc.closed_by = user.id
    doc.submitted_at = doc.approved_at = doc.closed_at = when

TODAY = local_today()
START = TODAY - timedelta(days=90)


def D(offset: int) -> date:
    return START + timedelta(days=offset)


MEAL_CATEGORIES = ["Breakfast", "Lunch", "Dinner", "Staff Meal"]

SUPPLIERS = [
    ("Gulf Fresh Produce", "Produce & Seafood"),
    ("Prime Meats & Poultry", "Butchery"),
    ("Al Rawabi Dairy & Pantry", "Dairy & Dry Goods"),
]

# name, category, unit, cost, supplier index (into SUPPLIERS)
NEW_FOOD_ITEMS = [
    ("Basmati Rice", "Dry Goods", "kg", 1.2, 2),
    ("Olive Oil", "Dry Goods", "L", 4.5, 2),
    ("Onion", "Vegetables", "kg", 0.6, 0),
    ("Garlic", "Vegetables", "kg", 2.0, 0),
    ("Butter", "Dairy", "kg", 5.5, 2),
    ("Milk", "Dairy", "L", 0.9, 2),
    ("Eggs", "Dairy", "units", 0.15, 2),
    ("Bell Pepper", "Vegetables", "kg", 1.8, 0),
    ("Dry Pasta", "Dry Goods", "kg", 1.0, 2),
    ("Prawns", "Seafood", "kg", 7.0, 0),
]

# Existing FoodInventory item -> supplier index, for the restock schedule.
EXISTING_ITEM_SUPPLIER = {
    "Duck Legs": 1,
    "Lobster Whole": 0,
    "Chicken Breast": 1,
    "Fresh Tomato Romano": 0,
}

# Restock jitter anchors on a known base price rather than the item's
# current (possibly zeroed-out or already-drifted) .cost, so re-running
# this script against a reset DB still produces realistic prices.
# Fresh Tomato Romano's original KWD 4.500/unit was leftover test-data
# pricing (never meant to be realistic) — corrected here to a plausible
# per-tomato price, since recipes use it by the piece.
EXISTING_ITEM_BASE_COST = {
    "Duck Legs": 5.6,
    "Lobster Whole": 10.0,
    "Chicken Breast": 1.9,
    "Fresh Tomato Romano": 0.25,
}

# (recipe name, category, [(ingredient item name, qty, yield_pct)], portion_size_g, prep_loss_pct)
RECIPE_DEFS = [
    ("Chicken Curry", "Dinner", [("Chicken Breast", 1.2, 100), ("Onion", 0.3, 100), ("Garlic", 0.05, 100)], 300, 10),
    ("Pasta Spaghetti", "Dinner", [("Dry Pasta", 0.5, 100), ("Fresh Tomato Romano", 6, 100), ("Olive Oil", 0.05, 100), ("Garlic", 0.03, 100)], 280, 5),
    ("Prawns Curry", "Dinner", [("Prawns", 0.8, 95), ("Onion", 0.2, 100), ("Garlic", 0.04, 100), ("Olive Oil", 0.05, 100)], 300, 8),
    ("Vegetable Rice Pilaf", "Lunch", [("Basmati Rice", 0.5, 100), ("Onion", 0.2, 100), ("Garlic", 0.03, 100), ("Olive Oil", 0.05, 100)], 250, 5),
    ("Creamy Garlic Chicken", "Dinner", [("Chicken Breast", 1.0, 100), ("Butter", 0.15, 100), ("Garlic", 0.05, 100), ("Milk", 0.3, 100)], 300, 10),
    # Same as the soup below: Eggs are also unit-tracked, so the mass
    # ingredients have to carry the whole batch size on their own.
    ("Classic Omelette", "Breakfast", [("Eggs", 12, 100), ("Butter", 0.1, 100), ("Bell Pepper", 0.4, 90), ("Onion", 0.3, 90)], 200, 5),
    # Fresh Tomato Romano is tracked in "units" (not a mass unit), so it
    # never counts toward raw_yield_g — onion+garlic have to carry the
    # batch size on their own, or portions collapses to 1 and every log
    # over-scales consumption by however many portions were served.
    ("Roasted Tomato Soup", "Lunch", [("Fresh Tomato Romano", 20, 100), ("Onion", 1.2, 100), ("Garlic", 0.08, 100), ("Olive Oil", 0.08, 100)], 250, 5),
]

MEAL_CATEGORY_RECIPES = {
    "Breakfast": ["Classic Omelette"],
    "Lunch": ["Vegetable Rice Pilaf", "Roasted Tomato Soup"],
    "Dinner": ["Chicken Curry", "Pasta Spaghetti", "Prawns Curry", "Creamy Garlic Chicken"],
}

# Matches the real Settings -> Waste Reasons list, not an invented one.
WASTE_REASONS = ["Spoilage", "Overproduction", "Trim/Prep Waste", "Expired", "Dropped/Contaminated"]

TRANSFER_REASONS = ["Staff meal prep", "Private event catering", "Poolside bar transfer", "Emergency top-up"]

KITCHEN_TASKS = [
    ("Morning prep station setup", ["Sanitize counters", "Check stock levels", "Prep mise en place"]),
    ("Weekly menu planning", ["Review upcoming events", "Confirm recipe costs", "Finalize weekly menu"]),
    ("Daily inventory reconciliation", ["Count perishables", "Log discrepancies", "Flag items to reorder"]),
    ("Supplier delivery check", ["Verify delivery against PO", "Inspect quality", "Log temperature on arrival"]),
    ("Kitchen deep clean", ["Clean equipment", "Sanitize walk-in fridge", "Degrease exhaust hood"]),
    ("Recipe costing review", ["Recalculate portion costs", "Compare to target food cost %", "Update pricing notes"]),
    ("Waste log review", ["Tally week's waste", "Identify root causes", "Report to manager"]),
    ("Equipment maintenance check", ["Test refrigeration temps", "Inspect gas lines", "Log any faults"]),
]


async def ensure_meal_categories(db):
    existing = {m.label for m in (await db.execute(select(MealCategory))).scalars().all()}
    for label in MEAL_CATEGORIES:
        if label not in existing:
            db.add(MealCategory(label=label))
    await db.flush()


async def ensure_suppliers(db) -> list[Supplier]:
    existing = {s.name: s for s in (await db.execute(select(Supplier))).scalars().all()}
    out = []
    for name, category in SUPPLIERS:
        if name in existing:
            out.append(existing[name])
            continue
        s = Supplier(name=name, category=category)
        db.add(s)
        await db.flush()
        out.append(s)
    return out


async def ensure_food_items(db, suppliers: list[Supplier]) -> dict[str, FoodInventory]:
    existing = {f.name: f for f in (await db.execute(select(FoodInventory))).scalars().all()}
    next_code_n = 2001
    for name, category, unit, cost, supplier_idx in NEW_FOOD_ITEMS:
        if name in existing:
            # A re-run against a reset DB (qty/cost zeroed by clearing
            # batches) would otherwise leave .cost at 0, which then makes
            # the restock schedule's price jitter fall back to a random
            # price uncorrelated with the item's real base cost.
            if float(existing[name].cost) == 0:
                existing[name].cost = cost
            continue
        f = FoodInventory(
            name=name, category=category, qty=0, unit=unit, cost=cost,
            supplier_id=suppliers[supplier_idx].id, min=2, max=20,
        )
        db.add(f)
        await db.flush()
        existing[name] = f
        while True:
            code = f"KIT-{next_code_n}"
            next_code_n += 1
            if not (await db.execute(select(ItemMaster).where(ItemMaster.code == code))).scalar_one_or_none():
                break
        im = ItemMaster(
            name=name, code=code, uom=unit, last_price=cost,
            preferred_supplier_id=suppliers[supplier_idx].id, active=True,
            stock_type="food", stock_id=f.id,
        )
        db.add(im)
        await db.flush()
    return existing


async def set_recipe_ingredients(db, recipe: Recipe, lines: list[tuple[str, float, float]], food_by_name: dict, portion_size_g: float, prep_loss_pct: float):
    await db.execute(RecipeIngredient.__table__.delete().where(RecipeIngredient.recipe_id == recipe.id))
    await db.flush()
    ingredients_in = []
    for item_name, qty, yield_pct in lines:
        stock = food_by_name[item_name]
        db.add(RecipeIngredient(recipe_id=recipe.id, food_inventory_id=stock.id, qty=qty, yield_pct=yield_pct))
        ingredients_in.append(RecipeIngredientIn(food_inventory_id=stock.id, qty=qty, yield_pct=yield_pct))
    await db.flush()
    recipe.raw_yield_g = await _compute_raw_yield_g(db, ingredients_in)
    recipe.portion_size_g = portion_size_g
    recipe.prep_loss_pct = prep_loss_pct


async def ensure_recipes(db, food_by_name: dict) -> None:
    existing = {r.name: r for r in (await db.execute(select(Recipe))).scalars().all()}
    for name, category, lines, portion_size_g, prep_loss_pct in RECIPE_DEFS:
        recipe = existing.get(name)
        if not recipe:
            recipe = Recipe(name=name, category=category, allergens=[])
            db.add(recipe)
            await db.flush()
        await set_recipe_ingredients(db, recipe, lines, food_by_name, portion_size_g, prep_loss_pct)
        # Guards against the exact bug this script hit once: an ingredient
        # tracked in a non-mass unit (units/L) contributes 0 to raw_yield_g,
        # so if the mass-tracked lines are too small the recipe collapses to
        # 1 portion and every meal-log over-scales consumption by however
        # many portions were actually served.
        final_yield_g = float(recipe.raw_yield_g) * (1 - float(recipe.prep_loss_pct) / 100)
        portions = max(1, round(final_yield_g / portion_size_g))
        assert portions >= 2, f"{name}: collapses to {portions} portion(s) — raw_yield_g={recipe.raw_yield_g}, check for non-mass-unit ingredients dominating the batch"
    await db.flush()


def build_restock_schedule(food_by_name: dict, base_cost: dict[str, float]) -> dict[str, list[tuple[int, float, float]]]:
    """Every item gets a restock roughly every 12-20 days across the window,
    at a random qty scaled to its unit (kg items order more than L/units).
    Price jitters off the item's known base cost, not its live .cost —
    that can be 0 right after a reset, which would otherwise fall back to
    a random price with no relation to the item's real value."""
    schedule: dict[str, list[tuple[int, float, float]]] = {}
    for name, item in food_by_name.items():
        events = []
        day = random.randint(0, 6)
        base_qty = 15 if item.unit == "kg" else (10 if item.unit == "L" else 24)
        anchor = base_cost.get(name, 1.0)
        while day <= 90:
            price_jitter = anchor * random.uniform(0.95, 1.08)
            qty = round(base_qty * random.uniform(0.7, 1.3), 1)
            events.append((day, qty, round(price_jitter, 3)))
            day += random.randint(12, 20)
        schedule[name] = events
    return schedule


async def receive_batch(db, item: FoodInventory, item_master: ItemMaster, supplier: Supplier, actor: User, day: int, qty: float, price: float):
    pr = PurchaseRequest(
        code=await _next_code(db, PurchaseRequest, "PR", 3001),
        requested_by=actor.id, request_date=D(day), status="Approved", urgency="Medium",
        required_delivery_date=D(day + 2),
    )
    db.add(pr)
    await db.flush()
    db.add(PurchaseRequestLine(
        pr_id=pr.id, item_master_id=item_master.id, item_name=item.name,
        qty=qty, unit=item.unit, category=item.category, est_unit_price=price, est_cost=round(qty * price, 2),
    ))

    po = PurchaseOrder(
        code=await _next_code(db, PurchaseOrder, "PO", 1001),
        supplier_id=supplier.id, status="Fully Received", order_date=D(day),
        expected_date=D(day + 2), total=round(qty * price, 2), payment_status="Paid",
        source_pr_id=pr.id, created_by=actor.id, approved_by=actor.id,
    )
    db.add(po)
    # Matches convert_pr_to_po's own status update — otherwise the PR sits
    # at "Approved" forever with a live "Create PO" action, even though a
    # PO already exists for it.
    pr.status = "Closed"
    await db.flush()

    po_line = PoLine(po_id=po.id, item_master_id=item_master.id, name=item.name, qty=qty, unit=item.unit, price=price, received_qty=qty)
    db.add(po_line)
    await db.flush()

    main = LOCATIONS[MAIN_STORE]
    grn = Grn(
        code=await _next_code(db, Grn, "GRN", 2001), po_id=po.id, supplier_id=supplier.id, date=D(day + 2),
        received_by=actor.id, receiving_cost_center_id=main.id,
    )
    _stamp(grn, actor, day + 2)
    db.add(grn)
    await db.flush()
    expiry = D(day + 2) + timedelta(days=random.randint(7, 45))
    db.add(GrnLine(
        grn_id=grn.id, po_line_id=po_line.id, name=item.name, ordered_qty=qty, received_qty=qty, unit=item.unit,
        ordered_price=price, price=price, expiry=expiry, batch_label=grn.code,
    ))
    movement = await stock_service.post_in(
        db, stock_type="food", stock_id=item.id, cc_id=main.id, qty=qty, unit_cost=price, txn_type="GRN",
        txn_id=grn.id, txn_code=grn.code, user=actor, batch_label=grn.code, expiry=expiry, received_date=D(day + 2),
        on=D(day + 2),
    )
    movement.created_at = _at(day + 2)

    item_master.last_price = price
    db.add(Expense(
        category="Residence Purchases", amount=round(qty * price, 2), date=D(day + 2),
        supplier=supplier.name, method="Bank Transfer", notes=f"Auto-logged from {grn.code} — {po.code}",
        created_by=actor.id,
    ))


async def log_meal(db, recipe: Recipe, meal_category: str, day: int, qty_portions: int, chef: User) -> bool:
    """Returns False (writing nothing) when the main store lacks stock for it."""
    cost, _ = await _resolve_recipe(db, recipe)
    main = LOCATIONS[MAIN_STORE]
    scale = qty_portions / (cost.portions or 1)
    consumed: dict = {}
    for item, consumed_qty in await _expand_consumption(db, recipe, scale):
        prev = consumed.get(item.id, (item, 0.0))[1]
        consumed[item.id] = (item, prev + consumed_qty)
    needed = [(item, qty) for item, qty in consumed.values() if round(qty, 3) > 0]
    for item, qty in needed:
        if await stock_service.balance(db, "food", item.id, main.id) + stock_service.EPS < round(qty, 3):
            return False

    meal = MealLog(
        code=await next_code(db, MealLog, "ML", 1001), date=D(day), category=meal_category,
        cost_center_id=main.id, cost_center=main.label, logged_by=chef.id,
    )
    _stamp(meal, chef, day)
    db.add(meal)
    await db.flush()
    db.add(MealLogLine(
        meal_log_id=meal.id, recipe_id=recipe.id, dish=recipe.name, qty=qty_portions, unit="portion",
        unit_cost=cost.cost_per_portion,
    ))
    for item, qty in needed:
        movements = await stock_service.post_out(
            db, stock_type="food", stock_id=item.id, cc_id=main.id, qty=qty, txn_type="MEAL_LOG",
            txn_id=meal.id, txn_code=meal.code, user=chef, on=D(day),
        )
        for m in movements:
            m.created_at = _at(day)
        db.add(ConsumptionLog(
            date=D(day), recipe_id=recipe.id, dish=recipe.name, meals_served=qty_portions,
            ingredient=item.name, qty_consumed=round(qty, 3), unit=item.unit,
            matched_stock_id=item.id, meal_log_id=meal.id,
        ))
    return True


async def log_waste(db, item: FoodInventory, day: int, chef: User) -> bool:
    main = LOCATIONS[MAIN_STORE]
    available = await stock_service.balance(db, "food", item.id, main.id)
    waste_qty = round(min(available, available * random.uniform(0.05, 0.15)), 2)
    if waste_qty <= 0:
        return False
    waste = WasteLog(
        code=await next_code(db, WasteLog, "WL", 1001), date=D(day), reason=random.choice(WASTE_REASONS),
        cost_center_id=main.id, notes=None, logged_by=chef.id, reviewed_by=chef.id,
    )
    _stamp(waste, chef, day)
    db.add(waste)
    await db.flush()
    movements = await stock_service.post_out(
        db, stock_type="food", stock_id=item.id, cc_id=main.id, qty=waste_qty, txn_type="WASTE",
        txn_id=waste.id, txn_code=waste.code, user=chef, on=D(day),
    )
    for m in movements:
        m.created_at = _at(day)
    db.add(WasteLogLine(
        waste_log_id=waste.id, food_inventory_id=item.id, ingredient_name=item.name, qty=waste_qty, unit=item.unit,
        unit_cost=stock_service.weighted_unit_cost(movements),
    ))
    return True


async def log_transfer(db, item: FoodInventory, day: int, chef: User) -> bool:
    main = LOCATIONS[MAIN_STORE]
    available = await stock_service.balance(db, "food", item.id, main.id)
    transfer_qty = round(min(available, available * random.uniform(0.08, 0.2)), 2)
    if transfer_qty <= 0:
        return False
    target = LOCATIONS[random.choice(TRANSFER_TARGETS)]
    transfer = StockTransfer(
        code=await next_code(db, StockTransfer, "RT", 1001), date=D(day), reason=random.choice(TRANSFER_REASONS),
        from_cost_center_id=main.id, to_cost_center_id=target.id, notes=None, logged_by=chef.id,
    )
    _stamp(transfer, chef, day)
    db.add(transfer)
    await db.flush()
    movements = await stock_service.post_transfer(
        db, stock_type="food", stock_id=item.id, from_cc=main.id, to_cc=target.id, qty=transfer_qty,
        txn_type="TRANSFER", txn_id=transfer.id, txn_code=transfer.code, user=chef, on=D(day),
    )
    for m in movements:
        m.created_at = _at(day)
    db.add(StockTransferLine(
        transfer_id=transfer.id, food_inventory_id=item.id, ingredient_name=item.name, qty=transfer_qty,
        unit=item.unit, unit_cost=stock_service.weighted_unit_cost(movements),
    ))
    return True


def task_status_for(days_ago: int) -> tuple[str, bool]:
    if days_ago > 7:
        status = random.choices(["Verified", "Completed"], weights=[9, 1])[0]
    elif days_ago > 1:
        status = random.choices(["Verified", "Completed", "In Progress"], weights=[6, 2, 2])[0]
    else:
        status = random.choices(["Pending", "In Progress", "Completed", "Verified"], weights=[3, 3, 2, 2])[0]
    return status, status == "Verified"


async def seed_kitchen_task(db, day: int, chef: StaffProfile, manager: StaffProfile):
    days_ago = 90 - day
    title, checklist_texts = random.choice(KITCHEN_TASKS)
    assignee = chef if random.random() > 0.15 else manager
    status, verified = task_status_for(days_ago)
    requires_verification = random.random() > 0.2

    start_hour = random.choice([6, 7, 8, 11, 12, 16, 17])
    start_t = time(start_hour, random.choice([0, 15, 30]))
    end_total = start_hour * 60 + start_t.minute + random.choice([30, 45, 60])
    end_t = time(min(end_total // 60, 21), end_total % 60)

    task = Task(
        title=title, category="Kitchen", description=None, assignee_id=assignee.id,
        location_id=None, priority=random.choice(["Low", "Medium", "Medium", "High"]),
        due_date=D(day), recurrence="One-time", requires_verification=requires_verification,
        status=status, verified=verified, photos=0,
    )
    db.add(task)
    await db.flush()
    done_default = status in ("Completed", "Verified")
    for i, text in enumerate(checklist_texts):
        db.add(TaskChecklistItem(
            task_id=task.id, text=text, done=done_default and random.random() > 0.1,
            start_time=start_t if i == 0 else None, end_time=end_t if i == 0 else None,
        ))


async def main():
    async with AsyncSessionLocal() as db:
        chef_sp, chef_user = (await db.execute(
            select(StaffProfile, User).join(User, StaffProfile.user_id == User.id).where(User.name == "Aiko Tanaka")
        )).one()
        manager_sp, manager_user = (await db.execute(
            select(StaffProfile, User).join(User, StaffProfile.user_id == User.id).where(User.name == "Ramon Villanueva")
        )).one()

        for cc in (await db.execute(select(CostCenter))).scalars().all():
            LOCATIONS[cc.label] = cc

        await ensure_meal_categories(db)
        suppliers = await ensure_suppliers(db)
        food_by_name = await ensure_food_items(db, suppliers)
        await ensure_recipes(db, food_by_name)
        await db.commit()

        # Reload maps fresh post-commit for id stability across the loop.
        food_by_name = {f.name: f for f in (await db.execute(select(FoodInventory))).scalars().all()}
        item_master_by_stock_id = {
            im.stock_id: im for im in (await db.execute(select(ItemMaster).where(ItemMaster.stock_type == "food"))).scalars().all()
        }
        recipes_by_name = {r.name: r for r in (await db.execute(select(Recipe))).scalars().all()}
        supplier_for_name = {}
        base_cost_for_name = dict(EXISTING_ITEM_BASE_COST)
        for name, _cat, _unit, cost, idx in NEW_FOOD_ITEMS:
            supplier_for_name[name] = suppliers[idx]
            base_cost_for_name[name] = cost
        for name, idx in EXISTING_ITEM_SUPPLIER.items():
            supplier_for_name[name] = suppliers[idx]

        restock_schedule = build_restock_schedule(food_by_name, base_cost_for_name)
        meal_category_list = list(MEAL_CATEGORY_RECIPES.keys())
        meals_logged = 0
        meals_skipped = 0
        waste_logged = 0
        transfers_logged = 0
        tasks_created = 0
        restocks_done = 0

        for day in range(0, 91):
            for name, events in restock_schedule.items():
                for ev_day, qty, price in events:
                    if ev_day == day:
                        item = food_by_name[name]
                        im = item_master_by_stock_id[item.id]
                        await receive_batch(db, item, im, supplier_for_name[name], manager_user, day, qty, price)
                        restocks_done += 1

            n_meals = random.choices([0, 1, 2, 3], weights=[1, 2, 4, 3])[0]
            meal_slots = random.sample(meal_category_list, k=min(n_meals, len(meal_category_list)))
            for meal_category in meal_slots:
                recipe_name = random.choice(MEAL_CATEGORY_RECIPES[meal_category])
                recipe = recipes_by_name[recipe_name]
                qty_portions = random.randint(2, 6)
                if await log_meal(db, recipe, meal_category, day, qty_portions, chef_user):
                    meals_logged += 1
                else:
                    meals_skipped += 1

            if random.random() < 0.15:
                candidates = [f for f in food_by_name.values() if float(f.qty) > 0]
                if candidates and await log_waste(db, random.choice(candidates), day, chef_user):
                    waste_logged += 1

            if random.random() < 0.12:
                candidates = [f for f in food_by_name.values() if float(f.qty) > 0]
                if candidates and await log_transfer(db, random.choice(candidates), day, chef_user):
                    transfers_logged += 1

            if random.random() < 0.35:
                await seed_kitchen_task(db, day, chef_sp, manager_sp)
                tasks_created += 1

            await db.commit()
            # Refresh food_by_name qty/cost view for next iteration's decisions.
            food_by_name = {f.name: f for f in (await db.execute(select(FoodInventory))).scalars().all()}

        print(f"Restocks: {restocks_done}, meals logged: {meals_logged} (skipped, no stock: {meals_skipped}), waste events: {waste_logged}, transfers: {transfers_logged}, kitchen tasks: {tasks_created}")
        print(f"Window: {D(0)} to {D(90)}")


if __name__ == "__main__":
    asyncio.run(main())

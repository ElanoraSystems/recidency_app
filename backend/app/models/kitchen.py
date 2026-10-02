import uuid
from datetime import date

from sqlalchemy import CheckConstraint, Date, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin, WorkflowMixin


class Recipe(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "recipes"

    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(60))  # Breakfast | Lunch | Dinner | Special Meals
    allergens: Mapped[list] = mapped_column(JSONB, default=list)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    prep_loss_pct: Mapped[float] = mapped_column(Numeric(5, 2), default=0)
    raw_yield_g: Mapped[float] = mapped_column(Numeric(10, 2), default=1000)
    portion_size_g: Mapped[float] = mapped_column(Numeric(10, 2), default=250)
    cooking_method: Mapped[str | None] = mapped_column(String(100), nullable=True)
    method: Mapped[str | None] = mapped_column(String, nullable=True)


class RecipeIngredient(Base, UUIDPKMixin):
    """An ingredient links to EXACTLY ONE of a real FoodInventory stock item
    or another Recipe (a sub-recipe) — never both, never neither (see the
    check constraint below). name/unit/cost_per_unit are never stored here,
    they're always read live: off FoodInventory for a stock ingredient, or
    recursively off the sub-recipe's own cost for a sub-recipe ingredient
    (see _resolve_recipe in app/api/v1/kitchen.py). RESTRICT (not SET
    NULL/CASCADE) on both FKs: a stock item or sub-recipe referenced by a
    recipe can't be deleted out from under it.

    A sub-recipe ingredient's qty is always in grams of the sub-recipe's own
    finished yield (Recipe.raw_yield_g/portion_size_g are gram-based
    throughout, so this needs no unit-override machinery the way a stock
    item does) — override_unit_id is only ever set for a stock ingredient."""

    __tablename__ = "recipe_ingredients"
    __table_args__ = (
        CheckConstraint(
            "(food_inventory_id IS NOT NULL) != (sub_recipe_id IS NOT NULL)",
            name="ck_recipe_ingredient_exactly_one_source",
        ),
    )

    recipe_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("recipes.id", ondelete="CASCADE"))
    food_inventory_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("food_inventory.id", ondelete="RESTRICT"), nullable=True
    )
    sub_recipe_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("recipes.id", ondelete="RESTRICT"), nullable=True
    )
    # Optional: this ingredient's qty is specified in a DIFFERENT (but
    # compatible, e.g. g when stock is kept in kg) unit than the linked
    # stock item's own unit. Null means "use the stock item's own unit" —
    # the original, simpler behavior. See app/services/units.py for the
    # conversion this enables. Never set for a sub-recipe ingredient.
    override_unit_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("units_of_measure.id", ondelete="SET NULL"), nullable=True
    )
    qty: Mapped[float] = mapped_column(Numeric(10, 3))
    # Edible-portion yield after trimming/prep loss for this ingredient
    # specifically (distinct from Recipe.prep_loss_pct, which is the whole
    # dish's raw-to-plated loss). 100 = no waste. Line cost is grossed up by
    # this so it reflects the as-purchased quantity actually needed.
    yield_pct: Mapped[float] = mapped_column(Numeric(5, 2), default=100)


class MealCategory(Base, UUIDPKMixin):
    """Owner-managed list (Settings -> Meal Categories) driving the category
    dropdown in Meal Log and Menu Proposals — previously a hardcoded list."""

    __tablename__ = "meal_categories"

    label: Mapped[str] = mapped_column(String(60), unique=True)


class FoodInventory(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "food_inventory"

    name: Mapped[str] = mapped_column(String(150))
    category: Mapped[str] = mapped_column(String(60))
    qty: Mapped[float] = mapped_column(Numeric(12, 3), default=0)
    unit: Mapped[str] = mapped_column(String(20))
    batch: Mapped[str | None] = mapped_column(String(40), nullable=True)
    expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    location: Mapped[str | None] = mapped_column(String(100), nullable=True)
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True
    )
    cost: Mapped[float] = mapped_column(Numeric(12, 6), default=0)
    min: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    max: Mapped[float] = mapped_column(Numeric(10, 2), default=0)


class FoodInventoryBatch(Base, UUIDPKMixin):
    """One received lot of a food item. FoodInventory.qty/.cost/.expiry/
    .batch are a maintained rollup of these — qty summed, cost weighted-
    averaged, expiry/batch taken from the soonest-expiring lot with stock
    left — so every existing reader of FoodInventory keeps working
    unchanged while gaining FEFO accuracy. See _recompute_food_rollup and
    _consume_fefo in app/api/v1/kitchen.py."""

    __tablename__ = "food_inventory_batches"

    food_inventory_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("food_inventory.id", ondelete="CASCADE")
    )
    batch_label: Mapped[str | None] = mapped_column(String(40), nullable=True)
    qty: Mapped[float] = mapped_column(Numeric(12, 3))
    expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    cost: Mapped[float] = mapped_column(Numeric(12, 6), default=0)
    received_date: Mapped[date] = mapped_column(Date)
    # The location (cost center) this lot physically sits in.
    cost_center_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("cost_centers.id", ondelete="RESTRICT"))


class MealLog(Base, UUIDPKMixin, TimestampMixin, WorkflowMixin):
    """Header of a meal-service transaction (see MealLogLine for the dishes).
    The cost center is both the transaction's title and the location whose
    stock the recipe ingredients are drawn from."""

    __tablename__ = "meal_log"

    code: Mapped[str] = mapped_column(String(20), unique=True)  # ML-1001
    date: Mapped[date] = mapped_column(Date)
    cost_center_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("cost_centers.id", ondelete="RESTRICT"))
    category: Mapped[str | None] = mapped_column(String(40), nullable=True)
    logged_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    # Label snapshot of the cost center at creation, so a later rename of
    # the Settings list doesn't rewrite history (same convention as category).
    cost_center: Mapped[str | None] = mapped_column(String(200), nullable=True)


class MealLogLine(Base, UUIDPKMixin):
    __tablename__ = "meal_log_lines"

    meal_log_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("meal_log.id", ondelete="CASCADE"))
    recipe_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("recipes.id", ondelete="SET NULL"), nullable=True
    )
    dish: Mapped[str] = mapped_column(String(200))
    qty: Mapped[int] = mapped_column(Integer)
    unit: Mapped[str] = mapped_column(String(20), default="portion")
    # Cost per portion; refreshed from the recipe's live cost when the
    # transaction is submitted, then frozen as the invoice figure.
    unit_cost: Mapped[float] = mapped_column(Numeric(10, 3), default=0)


class ConsumptionLog(Base, UUIDPKMixin):
    """Written atomically alongside a MealLog row when the dish is recipe-based:
    ingredients are deducted from food_inventory in the same DB transaction so
    the two can never drift apart (per the build plan, §03)."""

    __tablename__ = "consumption_log"

    date: Mapped[date] = mapped_column(Date)
    recipe_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("recipes.id", ondelete="SET NULL"), nullable=True
    )
    dish: Mapped[str] = mapped_column(String(200))
    meals_served: Mapped[int] = mapped_column(Integer)
    ingredient: Mapped[str] = mapped_column(String(150))
    qty_consumed: Mapped[float] = mapped_column(Numeric(12, 3))
    unit: Mapped[str] = mapped_column(String(20))
    matched_stock_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("food_inventory.id", ondelete="SET NULL"), nullable=True
    )
    meal_log_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("meal_log.id", ondelete="SET NULL"), nullable=True
    )


class StockTransfer(Base, UUIDPKMixin, TimestampMixin, WorkflowMixin):
    """Moves raw materials from one cost center (location) to another,
    without going through a Recipe/MealLog — for when there's no time to
    build a recipe first. Company stock is unchanged; only the location of
    the stock moves. See StockTransferLine for the items."""

    __tablename__ = "stock_transfers"

    code: Mapped[str] = mapped_column(String(20), unique=True)  # RT-1001
    date: Mapped[date] = mapped_column(Date)
    from_cost_center_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("cost_centers.id", ondelete="RESTRICT"))
    # Null only on transfers recorded before destinations existed, when this
    # was a pure withdrawal.
    to_cost_center_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cost_centers.id", ondelete="RESTRICT"), nullable=True
    )
    reason: Mapped[str] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    logged_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class StockTransferLine(Base, UUIDPKMixin):
    __tablename__ = "stock_transfer_lines"

    transfer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stock_transfers.id", ondelete="CASCADE"))
    food_inventory_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("food_inventory.id", ondelete="SET NULL"), nullable=True
    )
    ingredient_name: Mapped[str] = mapped_column(String(150))
    qty: Mapped[float] = mapped_column(Numeric(12, 3))
    unit: Mapped[str] = mapped_column(String(20))
    # Weighted cost of the batches actually moved, frozen when submitted.
    unit_cost: Mapped[float] = mapped_column(Numeric(12, 6), default=0)


class WasteReason(Base, UUIDPKMixin):
    """Owner-managed list (Settings -> Waste Reasons) driving the reason
    dropdown on the Kitchen Waste Log form."""

    __tablename__ = "waste_reasons"

    label: Mapped[str] = mapped_column(String(60), unique=True)


class CostCenter(Base, UUIDPKMixin):
    """Owner-managed list (Settings -> Cost Centers) driving the cost
    center dropdown on the Kitchen Meal Log form."""

    __tablename__ = "cost_centers"

    label: Mapped[str] = mapped_column(String(60), unique=True)


class WasteLog(Base, UUIDPKMixin, TimestampMixin, WorkflowMixin):
    """A batch of spoiled/wasted items logged in one go. On submit, the
    stock is deducted from `cost_center_id`'s location. See WasteLogLine
    for the individual items."""

    __tablename__ = "waste_log"

    code: Mapped[str] = mapped_column(String(20), unique=True)  # WL-1001
    date: Mapped[date] = mapped_column(Date)
    cost_center_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("cost_centers.id", ondelete="RESTRICT"))
    # Denormalized snapshot, not an FK to WasteReason — same convention as
    # MealLog.category, so a later rename/delete of the reason list doesn't
    # rewrite history.
    reason: Mapped[str] = mapped_column(String(60))
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    logged_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class WasteLogLine(Base, UUIDPKMixin):
    __tablename__ = "waste_log_lines"

    waste_log_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("waste_log.id", ondelete="CASCADE"))
    food_inventory_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("food_inventory.id", ondelete="SET NULL"), nullable=True
    )
    item_master_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("item_master.id", ondelete="SET NULL"), nullable=True
    )
    ingredient_name: Mapped[str] = mapped_column(String(150))
    qty: Mapped[float] = mapped_column(Numeric(12, 3))
    unit: Mapped[str] = mapped_column(String(20))
    # Snapshot of FoodInventory.cost at the moment of logging — a waste
    # log's whole point is tracking how much was thrown away, so this must
    # be captured historically rather than re-derived later.
    unit_cost: Mapped[float] = mapped_column(Numeric(12, 6), default=0)


class WeeklyMealPlan(Base, UUIDPKMixin, TimestampMixin):
    """A staff-meal week (Office or Residence occasion) built cell-by-cell in
    WeeklyMealPlanEntry, then submitted as a whole for approval."""

    __tablename__ = "weekly_meal_plans"

    occasion_type: Mapped[str] = mapped_column(String(60))  # Staff Meals – Office | Staff Meals – Residence
    week_start_date: Mapped[date] = mapped_column(Date)  # the Sunday starting this week
    status: Mapped[str] = mapped_column(String(20), default="Draft")  # Draft | Pending Approval | Approved
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class WeeklyMealPlanEntry(Base, UUIDPKMixin):
    __tablename__ = "weekly_meal_plan_entries"

    plan_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("weekly_meal_plans.id", ondelete="CASCADE"))
    day_of_week: Mapped[str] = mapped_column(String(3))  # sun, mon, tue, wed, thu, fri, sat
    meal_type: Mapped[str] = mapped_column(String(20))  # breakfast | lunch | dinner
    recipe_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("recipes.id", ondelete="SET NULL"), nullable=True
    )
    custom_meal_name: Mapped[str | None] = mapped_column(String(200), nullable=True)


class ProposedMenu(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "proposed_menus"

    occasion: Mapped[str] = mapped_column(String(200))
    occasion_type: Mapped[str] = mapped_column(String(60))
    for_date: Mapped[date] = mapped_column(Date)
    category: Mapped[str] = mapped_column(String(40))
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(20), default="Proposed")  # Proposed | Approved | Rejected
    notes: Mapped[str | None] = mapped_column(String, nullable=True)


class MenuOption(Base, UUIDPKMixin):
    __tablename__ = "menu_options"

    proposed_menu_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("proposed_menus.id", ondelete="CASCADE")
    )
    recipe_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("recipes.id", ondelete="CASCADE"))
    note: Mapped[str | None] = mapped_column(String(200), nullable=True)
    selected: Mapped[bool] = mapped_column(default=False)

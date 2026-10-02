import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPKMixin


class StockMovement(Base, UUIDPKMixin):
    """Append-only ledger of every stock change. A movement credits
    `to_cost_center_id` and debits `from_cost_center_id` (either may be null:
    receipts have no source, consumption has no destination). Reversals are
    new rows with from/to swapped, never edits, so the per-location balance
    is always sum(to) - sum(from) over every row."""

    __tablename__ = "stock_movements"
    __table_args__ = (
        Index("ix_stock_movements_item", "stock_type", "stock_id"),
        Index("ix_stock_movements_txn", "txn_id"),
        Index("ix_stock_movements_created", "created_at"),
    )

    txn_type: Mapped[str] = mapped_column(String(20))  # OPENING|GRN|MEAL_LOG|TRANSFER|WASTE|COUNT|REVERSAL
    txn_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    txn_code: Mapped[str | None] = mapped_column(String(30), nullable=True)
    stock_type: Mapped[str] = mapped_column(String(10))  # food | general
    stock_id: Mapped[uuid.UUID] = mapped_column()
    item_name: Mapped[str] = mapped_column(String(150))
    unit: Mapped[str] = mapped_column(String(20))
    from_cost_center_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cost_centers.id", ondelete="SET NULL"), nullable=True
    )
    to_cost_center_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cost_centers.id", ondelete="SET NULL"), nullable=True
    )
    qty: Mapped[float] = mapped_column(Numeric(12, 3))
    unit_cost: Mapped[float] = mapped_column(Numeric(12, 6), default=0)
    total_value: Mapped[float] = mapped_column(Numeric(14, 4), default=0)
    # Food only. `batch_id` is the batch the stock landed in (or, for an
    # out-movement, left from); `source_batch_id` is set on transfers for the
    # batch it left, so a reversal can restore both sides exactly.
    batch_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    source_batch_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(10), default="Posted")  # Posted | Reversed (display only)
    reverses_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class InventoryBalance(Base, UUIDPKMixin):
    """Per-location quantity of a general (non-batch) stock item. Food items
    need no equivalent: their per-location qty is the sum of their batches."""

    __tablename__ = "inventory_balances"
    __table_args__ = (UniqueConstraint("inventory_id", "cost_center_id", name="uq_inventory_balance_location"),)

    inventory_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("inventory.id", ondelete="CASCADE"))
    cost_center_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("cost_centers.id", ondelete="CASCADE"))
    qty: Mapped[float] = mapped_column(Numeric(12, 3), default=0)


class AuditLog(Base, UUIDPKMixin):
    """Per-record history: every create/edit/status change of a transaction,
    with who, when, the reason, and (for edits) a before/after snapshot."""

    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_log_entity", "entity_type", "entity_id"),)

    entity_type: Mapped[str] = mapped_column(String(30))
    entity_id: Mapped[uuid.UUID] = mapped_column()
    entity_code: Mapped[str | None] = mapped_column(String(30), nullable=True)
    action: Mapped[str] = mapped_column(String(20))
    from_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    user_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    reason: Mapped[str | None] = mapped_column(String, nullable=True)
    changes: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CostOfSales(Base, UUIDPKMixin):
    """Month-end cost of sales per cost center, written when a stock count is
    submitted. COS = opening stock + purchases + transfers in - transfers out
    - closing stock, all valued at cost from the movement ledger; one row per
    (cost center, month, stock type) and the latest count of a month replaces
    the earlier one."""

    __tablename__ = "cost_of_sales"
    __table_args__ = (UniqueConstraint("cost_center_id", "period", "stock_type", name="uq_cos_period"),)

    cost_center_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("cost_centers.id", ondelete="CASCADE"))
    period: Mapped[str] = mapped_column(String(7))  # YYYY-MM
    stock_type: Mapped[str] = mapped_column(String(10))  # food | general
    stock_count_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("stock_counts.id", ondelete="SET NULL"), nullable=True
    )
    count_date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    opening_value: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    purchases: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    transfers_in: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    transfers_out: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    closing_value: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    cost_of_sales: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    # Where the cost went: meals served, waste, and what the count found
    # missing (negative = surplus). These three sum to cost_of_sales.
    meals_value: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    waste_value: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    count_variance: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

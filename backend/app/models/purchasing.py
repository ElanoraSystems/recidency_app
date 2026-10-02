import uuid
from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin, WorkflowMixin


class UnitOfMeasure(Base, UUIDPKMixin):
    """Owner-managed list (Settings -> Units of Measure) driving every unit
    dropdown in the app (Item Master, Purchase Requests, Recipe ingredients).

    Units within the same "family" (mass, volume, count, ...) convert to
    each other via a single-level base-unit relationship: a base unit
    (e.g. "g") has base_unit_id = None and factor_to_base = 1; a derived
    unit (e.g. "kg") points at that base with the multiplier needed to
    reach it (1 kg = 1000 g -> factor_to_base = 1000). Two units convert
    iff they share the same ultimate base (see app/services/units.py) —
    units with no base (e.g. "units", "pack") don't convert to anything,
    which is correct: a pack isn't a universal multiple of a unit."""

    __tablename__ = "units_of_measure"

    label: Mapped[str] = mapped_column(String(20), unique=True)
    base_unit_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("units_of_measure.id", ondelete="SET NULL"), nullable=True
    )
    factor_to_base: Mapped[float] = mapped_column(Numeric(14, 6), default=1)


class Supplier(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "suppliers"

    name: Mapped[str] = mapped_column(String(150), unique=True)
    category: Mapped[str] = mapped_column(String(100))
    contact: Mapped[str | None] = mapped_column(String(150), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    rating: Mapped[float | None] = mapped_column(Numeric(2, 1), nullable=True)
    since: Mapped[str | None] = mapped_column(String(10), nullable=True)


class CreditNote(Base, UUIDPKMixin, TimestampMixin):
    """A supplier-issued credit (return, overcharge, damaged-goods refund,
    etc.) against a purchase — tracked as its own record, not a rewrite of
    the original PO/GRN, matching how Odoo's own credit notes sit alongside
    (never inside) the original purchase/vendor bill. Kept minimal on
    purpose: this exists so the accounting-side data is there for a later
    Odoo Purchase/Inventory/Accounting sync, not to build an AP ledger."""

    __tablename__ = "credit_notes"

    supplier_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("suppliers.id", ondelete="CASCADE"))
    po_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("purchase_orders.id", ondelete="SET NULL"), nullable=True
    )
    date: Mapped[date] = mapped_column(Date)
    reason: Mapped[str] = mapped_column(String(200))
    amount: Mapped[float] = mapped_column(Numeric(10, 2))
    notes: Mapped[str | None] = mapped_column(String, nullable=True)


class Inventory(Base, UUIDPKMixin, TimestampMixin):
    """General (non-food) inventory: cleaning, linen, toiletries, glassware, etc."""

    __tablename__ = "inventory"

    name: Mapped[str] = mapped_column(String(150))
    category: Mapped[str] = mapped_column(String(80))
    sku: Mapped[str] = mapped_column(String(40), unique=True)
    unit: Mapped[str] = mapped_column(String(20))
    stock: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    min: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    max: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    location: Mapped[str | None] = mapped_column(String(100), nullable=True)
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True
    )
    last_price: Mapped[float] = mapped_column(Numeric(10, 3), default=0)
    avg_price: Mapped[float] = mapped_column(Numeric(10, 3), default=0)
    expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    batch: Mapped[str | None] = mapped_column(String(40), nullable=True)


class ItemMaster(Base, UUIDPKMixin, TimestampMixin):
    """Central catalog. Points at its stock record via stock_type + stock_id
    so recipes, PRs, POs, GRNs and the shopping basket share one source of
    truth without duplicating the stock ledger (per the build plan, §03)."""

    __tablename__ = "item_master"

    name: Mapped[str] = mapped_column(String(150))
    code: Mapped[str] = mapped_column(String(40), unique=True)
    uom: Mapped[str] = mapped_column(String(20))
    last_price: Mapped[float] = mapped_column(Numeric(10, 3), default=0)
    preferred_supplier_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    stock_type: Mapped[str] = mapped_column(String(10))  # food | general
    stock_id: Mapped[uuid.UUID] = mapped_column()  # points into food_inventory or inventory


class StockCount(Base, UUIDPKMixin, TimestampMixin):
    """A physical stock-take. Lines snapshot each active item's book qty at
    count start; submitting posts the variance (counted - book) onto the
    real stock row so it matches what was physically counted."""

    __tablename__ = "stock_counts"

    date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="Draft")  # Draft | Submitted
    # The location being counted; book_qty is that location's balance.
    cost_center_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cost_centers.id", ondelete="RESTRICT"), nullable=True
    )
    counted_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(String, nullable=True)


class StockCountLine(Base, UUIDPKMixin):
    __tablename__ = "stock_count_lines"

    count_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stock_counts.id", ondelete="CASCADE"))
    item_master_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("item_master.id", ondelete="CASCADE"))
    book_qty: Mapped[float] = mapped_column(Numeric(12, 3))
    counted_qty: Mapped[float | None] = mapped_column(Numeric(12, 3), nullable=True)
    unit_cost: Mapped[float] = mapped_column(Numeric(12, 6), default=0)


class PurchaseRequest(Base, UUIDPKMixin, TimestampMixin):
    """Header for a multi-item request — see PurchaseRequestLine for the
    items themselves. One PR, N lines, approved and converted as a unit."""

    __tablename__ = "purchase_requests"

    code: Mapped[str] = mapped_column(String(20), unique=True)  # PR-3001
    requested_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    request_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(30), default="Pending Approval")
    urgency: Mapped[str] = mapped_column(String(20), default="Medium")
    note: Mapped[str | None] = mapped_column(String, nullable=True)
    # Owner-managed list (Settings -> Cost Centers) — which budget the
    # request is charged to. Required for a new request; nullable so
    # requests created before this field existed stay valid.
    cost_center: Mapped[str | None] = mapped_column(String(80), nullable=True)


class PurchaseRequestLine(Base, UUIDPKMixin):
    __tablename__ = "purchase_request_lines"

    pr_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("purchase_requests.id", ondelete="CASCADE"))
    # Nullable — a custom item not in the catalog is still a valid line,
    # it just has no Item Master row (and so no preferred_supplier_id to
    # auto-group by when converting to a PO).
    item_master_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("item_master.id", ondelete="SET NULL"), nullable=True
    )
    item_name: Mapped[str] = mapped_column(String(150))
    qty: Mapped[float] = mapped_column(Numeric(10, 2))
    unit: Mapped[str] = mapped_column(String(20))
    category: Mapped[str] = mapped_column(String(80))
    est_cost: Mapped[float] = mapped_column(Numeric(10, 2), default=0)


class PurchaseOrder(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "purchase_orders"

    code: Mapped[str] = mapped_column(String(20), unique=True)  # PO-1042
    supplier_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("suppliers.id"))
    status: Mapped[str] = mapped_column(String(30), default="Pending Approval")
    order_date: Mapped[date] = mapped_column(Date)
    expected_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    total: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    payment_status: Mapped[str] = mapped_column(String(20), default="Unpaid")
    source_pr_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("purchase_requests.id", ondelete="SET NULL"), nullable=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class PoLine(Base, UUIDPKMixin):
    __tablename__ = "po_lines"

    po_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("purchase_orders.id", ondelete="CASCADE"))
    item_master_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("item_master.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(150))
    qty: Mapped[float] = mapped_column(Numeric(10, 2))
    unit: Mapped[str] = mapped_column(String(20))
    price: Mapped[float] = mapped_column(Numeric(10, 3))
    last_price: Mapped[float | None] = mapped_column(Numeric(10, 3), nullable=True)
    received_qty: Mapped[float] = mapped_column(Numeric(10, 2), default=0)


class Grn(Base, UUIDPKMixin, TimestampMixin, WorkflowMixin):
    __tablename__ = "grns"

    code: Mapped[str] = mapped_column(String(20), unique=True)  # GRN-2001
    po_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("purchase_orders.id"))
    supplier_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("suppliers.id"))
    date: Mapped[date] = mapped_column(Date)
    # Where the goods are physically received; stock is registered here.
    receiving_cost_center_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cost_centers.id", ondelete="RESTRICT")
    )
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    received_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class GrnLine(Base, UUIDPKMixin):
    __tablename__ = "grn_lines"

    grn_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("grns.id", ondelete="CASCADE"))
    po_line_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("po_lines.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(150))
    ordered_qty: Mapped[float] = mapped_column(Numeric(10, 2))
    received_qty: Mapped[float] = mapped_column(Numeric(10, 2))
    unit: Mapped[str] = mapped_column(String(20))
    # The PO's price at the time of receiving — snapshotted here (like
    # ordered_qty) so this record stays self-contained even if the PO later
    # changes. `price` is the ACTUAL price this receipt was invoiced/paid
    # at — they differ when the supplier adjusted price between order and
    # delivery; `price == ordered_price` means no adjustment happened.
    ordered_price: Mapped[float] = mapped_column(Numeric(10, 3))
    price: Mapped[float] = mapped_column(Numeric(10, 3))
    # Food lots only; recorded on the GRN itself so the document is
    # self-contained (the batch row is what stock actually draws from).
    expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    batch_label: Mapped[str | None] = mapped_column(String(40), nullable=True)

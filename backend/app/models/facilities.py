import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class Area(Base, UUIDPKMixin, TimestampMixin):
    """Free-form room/kitchen/office list from Residence Setup. Everything
    else's 'location' is a foreign key into this, not free text."""

    __tablename__ = "areas"

    name: Mapped[str] = mapped_column(String(150))
    category: Mapped[str] = mapped_column(String(60))
    checklist: Mapped[list] = mapped_column(JSONB, default=list)
    last_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_inspected: Mapped[date | None] = mapped_column(Date, nullable=True)
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("staff_profiles.id", ondelete="SET NULL"), nullable=True
    )
    completion: Mapped[int] = mapped_column(Integer, default=0)
    # The real task counts behind `completion` — see
    # app.api.v1.tasks._recompute_area_completion. Exposed separately so the
    # UI can show a true "N of M tasks done" instead of back-deriving a count
    # from the unrelated static `checklist` label list.
    completion_tasks_done: Mapped[int] = mapped_column(Integer, default=0)
    completion_tasks_total: Mapped[int] = mapped_column(Integer, default=0)


class AreaType(Base, UUIDPKMixin):
    """Owner-managed list (Settings -> Area Types) driving the Type dropdown
    on the Add/Edit residence area form — previously a hardcoded datalist."""

    __tablename__ = "area_types"

    label: Mapped[str] = mapped_column(String(60), unique=True)


class Inspection(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "inspections"

    area_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("areas.id", ondelete="CASCADE"))
    score: Mapped[int] = mapped_column(Integer)
    inspector: Mapped[str] = mapped_column(String(150))
    date: Mapped[date] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)


class Asset(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "assets"

    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(100))
    brand: Mapped[str | None] = mapped_column(String(100), nullable=True)
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    serial: Mapped[str | None] = mapped_column(String(100), nullable=True)
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("areas.id", ondelete="SET NULL"), nullable=True
    )
    install_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    warranty_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_service: Mapped[date | None] = mapped_column(Date, nullable=True)
    next_service: Mapped[date | None] = mapped_column(Date, nullable=True)
    provider: Mapped[str | None] = mapped_column(String(150), nullable=True)
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True
    )
    purchase_cost: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="Active")
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("staff_profiles.id", ondelete="SET NULL"), nullable=True
    )
    approval_status: Mapped[str] = mapped_column(String(20), default="Approved")  # Pending | Approved
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class MaintenanceRequest(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "maintenance_requests"

    issue: Mapped[str] = mapped_column(String(200))
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("areas.id", ondelete="SET NULL"), nullable=True
    )
    asset_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("assets.id", ondelete="SET NULL"), nullable=True
    )
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    priority: Mapped[str] = mapped_column(String(20), default="Medium")
    reported_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reported_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="Reported")
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("staff_profiles.id", ondelete="SET NULL"), nullable=True
    )
    verified: Mapped[bool] = mapped_column(default=False)


class PmSchedule(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "pm_schedule"

    asset_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assets.id", ondelete="CASCADE"))
    task: Mapped[str] = mapped_column(String(200))
    frequency: Mapped[str] = mapped_column(String(40))
    due_date: Mapped[date] = mapped_column(Date)


class Vehicle(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "vehicles"

    name: Mapped[str] = mapped_column(String(150))
    reg: Mapped[str] = mapped_column(String(40), unique=True)
    driver_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("staff_profiles.id", ondelete="SET NULL"), nullable=True
    )
    mileage: Mapped[int] = mapped_column(Integer, default=0)
    insurance_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    reg_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_service: Mapped[date | None] = mapped_column(Date, nullable=True)
    next_service: Mapped[date | None] = mapped_column(Date, nullable=True)
    tyre_status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    battery: Mapped[str | None] = mapped_column(String(80), nullable=True)
    fuel_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    color: Mapped[str | None] = mapped_column(String(40), nullable=True)


class VehicleHistory(Base, UUIDPKMixin):
    __tablename__ = "vehicle_history"

    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicles.id", ondelete="CASCADE"))
    date: Mapped[date] = mapped_column(Date)
    type: Mapped[str] = mapped_column(String(30))  # Service | Repair
    description: Mapped[str] = mapped_column(String(300))
    cost: Mapped[float] = mapped_column(Numeric(10, 2))


class Attachment(Base, UUIDPKMixin):
    """Polymorphic file attachment (photos/documents) for maintenance-domain
    entities — asset records, maintenance requests. Same local-disk /
    S3-key convention as DocumentFile."""

    __tablename__ = "attachments"

    entity_type: Mapped[str] = mapped_column(String(40))  # asset | maintenance_request
    entity_id: Mapped[uuid.UUID] = mapped_column()
    s3_key: Mapped[str] = mapped_column(String(500))
    filename: Mapped[str] = mapped_column(String(300))
    content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(nullable=True)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    uploaded_at: Mapped[date] = mapped_column(Date)

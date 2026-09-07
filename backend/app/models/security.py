import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPKMixin


class PatrolLog(Base, UUIDPKMixin):
    """One guard's QR scan at one Area, at one instant — see
    app/api/v1/patrol.py for the check-in endpoint. staff_id/scanned_at are
    always server-set, never trusted from the client (same rationale as
    MaintenanceRequest.reported_by)."""

    __tablename__ = "patrol_log"

    area_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("areas.id", ondelete="SET NULL"), nullable=True
    )
    staff_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("staff_profiles.id", ondelete="SET NULL"), nullable=True
    )
    scanned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    notes: Mapped[str | None] = mapped_column(String, nullable=True)

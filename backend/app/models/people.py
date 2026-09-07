import uuid
from datetime import date, time

from sqlalchemy import Date, ForeignKey, Numeric, String, Time
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class StaffProfile(Base, UUIDPKMixin, TimestampMixin):
    """1:1 with a users row (user_type='staff' or 'owner'). Holds everything
    the People module needs beyond login credentials."""

    __tablename__ = "staff_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    # Reviewer for this staff member's completed tasks (self-referencing).
    # If unset, the Owner is treated as the fallback reviewer — see
    # approvals.py's task_review handling.
    supervisor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("staff_profiles.id", ondelete="SET NULL"), nullable=True
    )

    position: Mapped[str] = mapped_column(String(120))
    department: Mapped[str] = mapped_column(String(80))
    join_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="Active")  # Active | On Leave | Inactive
    off_site_role: Mapped[bool] = mapped_column(default=False)

    id_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    id_number: Mapped[str | None] = mapped_column(String(80), nullable=True)
    id_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)

    contract_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    contract_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    salary: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    salary_currency: Mapped[str] = mapped_column(String(10), default="KWD")

    emergency_contact: Mapped[dict] = mapped_column(JSONB, default=dict)  # {name, relation, phone}
    responsibilities: Mapped[list] = mapped_column(JSONB, default=list)
    uniform: Mapped[list] = mapped_column(JSONB, default=list)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)


class Attendance(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "attendance"

    staff_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("staff_profiles.id", ondelete="CASCADE"))
    date: Mapped[date] = mapped_column(Date)
    check_in: Mapped[time | None] = mapped_column(Time, nullable=True)
    check_out: Mapped[time | None] = mapped_column(Time, nullable=True)
    status: Mapped[str] = mapped_column(String(20))  # Present | Absent | On Leave


class LeaveRequest(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "leave_requests"

    staff_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("staff_profiles.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(40))
    from_date: Mapped[date] = mapped_column(Date)
    to_date: Mapped[date] = mapped_column(Date)
    days: Mapped[int] = mapped_column(default=1)
    status: Mapped[str] = mapped_column(String(20), default="Pending")  # Pending | Approved | Rejected
    reason: Mapped[str | None] = mapped_column(String, nullable=True)
    requested_on: Mapped[date] = mapped_column(Date)


class Shift(Base, UUIDPKMixin):
    __tablename__ = "shifts"

    staff_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("staff_profiles.id", ondelete="CASCADE"), unique=True
    )
    pattern: Mapped[dict] = mapped_column(JSONB, default=dict)  # {mon: "07:00-15:00", ...}


class ShiftPattern(Base, UUIDPKMixin):
    """Owner-managed list of selectable shift-schedule values (Settings ->
    Shift Patterns), so the Shift Schedule grid offers a dropdown instead of
    free text."""

    __tablename__ = "shift_patterns"

    label: Mapped[str] = mapped_column(String(60), unique=True)

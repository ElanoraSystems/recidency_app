import uuid
from datetime import date, time

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, Time
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class FamilyMember(Base, UUIDPKMixin, TimestampMixin):
    """Family profiles (dietary, allergies, preferences) stay separate from
    family_accounts — not every family member needs a login."""

    __tablename__ = "family_members"

    name: Mapped[str] = mapped_column(String(150))
    relation: Mapped[str] = mapped_column(String(60))
    dietary: Mapped[str | None] = mapped_column(String(200), nullable=True)
    allergies: Mapped[str | None] = mapped_column(String(200), nullable=True)
    preferences: Mapped[str | None] = mapped_column(String, nullable=True)


class Guest(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "guests"

    name: Mapped[str] = mapped_column(String(200))
    arrival: Mapped[date] = mapped_column(Date)
    arrival_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    departure: Mapped[date] = mapped_column(Date)
    departure_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    count: Mapped[int] = mapped_column(Integer, default=1)
    room: Mapped[str | None] = mapped_column(String(150), nullable=True)
    dietary: Mapped[str | None] = mapped_column(String(200), nullable=True)
    requests: Mapped[str | None] = mapped_column(String, nullable=True)
    driver_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("staff_profiles.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(String, nullable=True)


class Event(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "events"

    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(60))
    date: Mapped[date] = mapped_column(Date)
    time: Mapped[time | None] = mapped_column(Time, nullable=True)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    guests_count: Mapped[int] = mapped_column(Integer, default=0)
    menu: Mapped[str | None] = mapped_column(String, nullable=True)
    shopping: Mapped[str | None] = mapped_column(String, nullable=True)
    staff_needed: Mapped[list] = mapped_column(JSONB, default=list)  # list of staff_profile ids (str)
    cleaning: Mapped[str | None] = mapped_column(String, nullable=True)
    maintenance: Mapped[str | None] = mapped_column(String, nullable=True)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    tasks_generated: Mapped[bool] = mapped_column(Boolean, default=False)

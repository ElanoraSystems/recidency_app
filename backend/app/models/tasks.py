import uuid
from datetime import date, time

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, Time
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class TaskTemplate(Base, UUIDPKMixin):
    __tablename__ = "task_templates"

    title: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(60))
    recurrence: Mapped[str] = mapped_column(String(30))
    # Only meaningful when recurrence == "Custom" — mirrors Task.recurrence_interval_days.
    recurrence_interval_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Each entry is {"text": str, "start_time": "HH:MM:SS" | None, "end_time": "HH:MM:SS" | None}.
    # Timing lives per checklist item, not once for the whole template/task —
    # a single time block doesn't fit a checklist covering several distinct
    # activities. Carried onto every TaskChecklistItem a spawned task gets.
    items: Mapped[list] = mapped_column(JSONB, default=list)
    requires_verification: Mapped[bool] = mapped_column(Boolean, default=True)


class TaskCategory(Base, UUIDPKMixin):
    """Owner-managed list (Settings -> Task Categories) driving the Category
    dropdown on the New Task form — previously a hardcoded array."""

    __tablename__ = "task_categories"

    label: Mapped[str] = mapped_column(String(60), unique=True)


class Task(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "tasks"

    title: Mapped[str] = mapped_column(String(250))
    category: Mapped[str] = mapped_column(String(60))
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("staff_profiles.id", ondelete="SET NULL"), nullable=True
    )
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("areas.id", ondelete="SET NULL"), nullable=True
    )
    priority: Mapped[str] = mapped_column(String(20), default="Medium")
    due_date: Mapped[date] = mapped_column(Date)
    recurrence: Mapped[str] = mapped_column(String(30), default="One-time")
    # Only meaningful when recurrence == "Custom" — Daily/Weekly/Monthly have
    # a fixed, implied interval. See approvals.py's task_review decision for
    # where the next occurrence actually gets created.
    recurrence_interval_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # False lets a staff member's own "Completed" stand as done, no
    # supervisor review required — see tasks.py's update_task_status.
    requires_verification: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(20), default="Pending")
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    photos: Mapped[int] = mapped_column(Integer, default=0)


class TaskChecklistItem(Base, UUIDPKMixin):
    __tablename__ = "task_checklist_items"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    text: Mapped[str] = mapped_column(String(200))
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    # Optional scheduled block for this specific item — moved down from the
    # task level since a task's checklist can cover several activities at
    # different times of day. See tasks.py's _check_overlap.
    start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    end_time: Mapped[time | None] = mapped_column(Time, nullable=True)


class TaskComment(Base, UUIDPKMixin):
    __tablename__ = "task_comments"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    author_name: Mapped[str] = mapped_column(String(150))
    text: Mapped[str] = mapped_column(String)
    at: Mapped[date] = mapped_column(Date)


class GardenTask(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "garden_tasks"

    title: Mapped[str] = mapped_column(String(200))
    zone: Mapped[str] = mapped_column(String(100))
    frequency: Mapped[str] = mapped_column(String(30))
    last_done: Mapped[date | None] = mapped_column(Date, nullable=True)
    next_due: Mapped[date] = mapped_column(Date)
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("staff_profiles.id", ondelete="SET NULL"), nullable=True
    )


class PoolLog(Base, UUIDPKMixin):
    __tablename__ = "pool_log"

    date: Mapped[date] = mapped_column(Date)
    ph: Mapped[float] = mapped_column()
    chlorine: Mapped[float] = mapped_column()
    temp: Mapped[float] = mapped_column()
    filter_cleaned: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)

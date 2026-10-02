import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class UUIDPKMixin:
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


def _user_fk() -> "Mapped[uuid.UUID | None]":
    return mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class WorkflowMixin:
    """Draft -> Submitted -> Approved -> Closed, with who/when for each step.
    See app/services/workflow.py for the allowed transitions and what each
    one does to stock."""

    status: Mapped[str] = mapped_column(String(20), default="Draft", server_default="Draft")
    submitted_by: Mapped[uuid.UUID | None] = _user_fk()
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by: Mapped[uuid.UUID | None] = _user_fk()
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_by: Mapped[uuid.UUID | None] = _user_fk()
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

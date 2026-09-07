import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class ActivityLog(Base, UUIDPKMixin, TimestampMixin):
    """Every write handler appends here. The Approval Inbox is a query across
    PRs, POs, proposals, assets and leave — a view, not a stored table."""

    __tablename__ = "activity_log"

    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    actor_name: Mapped[str] = mapped_column(String(150))
    role_label: Mapped[str] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(200))
    detail: Mapped[str | None] = mapped_column(String, nullable=True)

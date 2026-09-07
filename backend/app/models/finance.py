import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class ResidenceSettings(Base, UUIDPKMixin):
    """Singleton row: residence identity + monthly budget."""

    __tablename__ = "residence_settings"

    name: Mapped[str] = mapped_column(String(150))
    location: Mapped[str | None] = mapped_column(String(150), nullable=True)
    currency: Mapped[str] = mapped_column(String(10), default="KWD")
    timezone: Mapped[str] = mapped_column(String(60), default="Asia/Kuwait")
    monthly_budget: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    # Letterhead fields for generated PDFs (POs, invoices) — see
    # app/services/pdf.py and the /settings/residence/logo endpoints.
    logo_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    terms_and_conditions: Mapped[str | None] = mapped_column(String, nullable=True)


class Expense(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "expenses"

    category: Mapped[str] = mapped_column(String(60))
    amount: Mapped[float] = mapped_column(Numeric(10, 2))
    date: Mapped[date] = mapped_column(Date)
    supplier: Mapped[str | None] = mapped_column(String(150), nullable=True)
    method: Mapped[str] = mapped_column(String(30))  # Card | Cash | Bank Transfer
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class Document(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "documents"

    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(80))
    linked_to: Mapped[str | None] = mapped_column(String(200), nullable=True)
    upload_date: Mapped[date] = mapped_column(Date)
    expiry: Mapped[date | None] = mapped_column(Date, nullable=True)


class DocumentFile(Base, UUIDPKMixin):
    """S3 object key metadata. A document can have zero or several file
    versions (per the build plan, §03)."""

    __tablename__ = "document_files"

    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    s3_key: Mapped[str] = mapped_column(String(500))
    filename: Mapped[str] = mapped_column(String(300))
    content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(nullable=True)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    uploaded_at: Mapped[date] = mapped_column(Date)

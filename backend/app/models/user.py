import uuid

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class User(Base, UUIDPKMixin, TimestampMixin):
    """Owner, staff and family are one users table with a user_type — module
    access is data (role_module_access / family_module_access), not code."""

    __tablename__ = "users"

    user_type: Mapped[str] = mapped_column(String(20))  # owner | staff | family
    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(200), unique=True, nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    # {category: bool} — missing categories default to enabled (see settings.py)
    notification_prefs: Mapped[dict] = mapped_column(JSONB, default=dict)

    role_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("roles.id"), nullable=True)
    role: Mapped["Role"] = relationship(back_populates="users")


class Role(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "roles"

    key: Mapped[str] = mapped_column(String(40), unique=True)  # owner, manager, chef, ...
    label: Mapped[str] = mapped_column(String(100))

    users: Mapped[list["User"]] = relationship(back_populates="role")
    module_access: Mapped[list["RoleModuleAccess"]] = relationship(
        back_populates="role", cascade="all, delete-orphan"
    )


class RoleModuleAccess(Base, UUIDPKMixin):
    __tablename__ = "role_module_access"

    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"))
    module: Mapped[str] = mapped_column(String(40))

    role: Mapped["Role"] = relationship(back_populates="module_access")


class FamilyAccount(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "family_accounts"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    family_member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("family_members.id", ondelete="SET NULL"), nullable=True
    )
    relation: Mapped[str] = mapped_column(String(80))
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    module_access: Mapped[list["FamilyModuleAccess"]] = relationship(
        back_populates="family_account", cascade="all, delete-orphan"
    )


class FamilyModuleAccess(Base, UUIDPKMixin):
    __tablename__ = "family_module_access"

    family_account_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("family_accounts.id", ondelete="CASCADE")
    )
    module: Mapped[str] = mapped_column(String(40))

    family_account: Mapped["FamilyAccount"] = relationship(back_populates="module_access")

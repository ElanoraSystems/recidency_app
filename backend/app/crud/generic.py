"""Generic CRUD router factory.

Most tables in this app are plain resource collections (list / get / create /
update / delete) with no special business logic — housekeeping areas,
suppliers, vehicles, guests, and so on. Rather than hand-write near-identical
routers ~35 times, this introspects a SQLAlchemy model's columns and builds
Pydantic request/response schemas and a router on the fly.

Tables with real business logic (auth, meal-log consumption, the PR→PO→GRN
chain, approvals, activity log) get hand-written routers instead — see
app/api/v1/*.py.
"""

import decimal
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ConfigDict, create_model
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.types import JSON

from app.api.deps import get_current_user, require_module
from app.db.session import get_db
from app.models.user import User


def _python_type(column) -> Any:
    # JSON/JSONB columns can hold lists as easily as dicts — SQLAlchemy's
    # JSON.python_type always reports `dict`, which breaks response
    # validation for our list-shaped columns (checklists, staff_needed, ...).
    if isinstance(column.type, JSON):
        return Any
    try:
        pt = column.type.python_type
    except NotImplementedError:
        return Any
    # Pydantic serializes Decimal as a string (to preserve precision), which
    # silently breaks arithmetic on the frontend. Numeric columns should just
    # be floats over the wire.
    if pt is decimal.Decimal:
        return float
    return pt


def _schema_fields(model, *, optional: bool, skip: set[str]) -> dict[str, tuple]:
    fields: dict[str, tuple] = {}
    for column in model.__table__.columns:
        if column.name in skip:
            continue
        pt = _python_type(column)
        # A column the caller can safely omit: it's nullable, we're building
        # an Update schema (optional=True), or the DB/ORM already knows what
        # to fill in (a Python-side `default=` or a `server_default=`) — the
        # generated Create schema was previously marking columns like
        # `verified: Mapped[bool] = mapped_column(default=False)` as
        # *required*, so any form that didn't send them 422'd.
        has_default = column.default is not None or column.server_default is not None
        omittable = column.nullable or optional or has_default
        typ = pt | None if omittable else pt
        default = None if omittable else ...
        fields[column.name] = (typ, default)
    return fields


def build_schemas(model, name: str, *, skip_write: set[str] | None = None):
    skip_write = skip_write or {"id", "created_at", "updated_at"}
    always_skip = {"created_at", "updated_at"}

    read_fields = _schema_fields(model, optional=True, skip=set())
    read_fields["id"] = (uuid.UUID, ...)
    ReadModel = create_model(
        f"{name}Read", __config__=ConfigDict(from_attributes=True), **read_fields
    )

    create_fields = _schema_fields(model, optional=False, skip=skip_write)
    CreateModel = create_model(f"{name}Create", **create_fields)

    update_fields = _schema_fields(model, optional=True, skip=skip_write | always_skip)
    UpdateModel = create_model(f"{name}Update", **update_fields)

    return ReadModel, CreateModel, UpdateModel


def make_router(
    model,
    *,
    prefix: str,
    tag: str,
    module: str,
    schema_name: str | None = None,
    skip_write: set[str] | None = None,
    read_only: bool = False,
    order_by: str | None = None,
) -> APIRouter:
    ReadModel, CreateModel, UpdateModel = build_schemas(
        model, schema_name or model.__name__, skip_write=skip_write
    )
    router = APIRouter(prefix=prefix, tags=[tag])
    module_dep = require_module(module)

    @router.get("", response_model=list[ReadModel])
    async def list_items(
        db: AsyncSession = Depends(get_db), _user: User = Depends(module_dep)
    ):
        stmt = select(model)
        if order_by and hasattr(model, order_by):
            stmt = stmt.order_by(getattr(model, order_by).desc())
        result = await db.execute(stmt)
        return result.scalars().all()

    @router.get("/{item_id}", response_model=ReadModel)
    async def get_item(
        item_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(module_dep)
    ):
        obj = await db.get(model, item_id)
        if not obj:
            raise HTTPException(404, f"{schema_name or model.__name__} not found")
        return obj

    if not read_only:

        @router.post("", response_model=ReadModel, status_code=201)
        async def create_item(
            payload: CreateModel,  # type: ignore[valid-type]
            db: AsyncSession = Depends(get_db),
            _user: User = Depends(module_dep),
        ):
            obj = model(**payload.model_dump(exclude_unset=True))
            db.add(obj)
            await db.commit()
            await db.refresh(obj)
            return obj

        @router.patch("/{item_id}", response_model=ReadModel)
        async def update_item(
            item_id: uuid.UUID,
            payload: UpdateModel,  # type: ignore[valid-type]
            db: AsyncSession = Depends(get_db),
            _user: User = Depends(module_dep),
        ):
            obj = await db.get(model, item_id)
            if not obj:
                raise HTTPException(404, f"{schema_name or model.__name__} not found")
            for key, value in payload.model_dump(exclude_unset=True).items():
                setattr(obj, key, value)
            await db.commit()
            await db.refresh(obj)
            return obj

        @router.delete("/{item_id}", status_code=204)
        async def delete_item(
            item_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(module_dep)
        ):
            obj = await db.get(model, item_id)
            if not obj:
                raise HTTPException(404, f"{schema_name or model.__name__} not found")
            await db.execute(sa_delete(model).where(model.id == item_id))
            await db.commit()

    return router

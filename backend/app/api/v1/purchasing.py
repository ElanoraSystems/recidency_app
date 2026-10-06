import uuid
from datetime import date, datetime, timezone
from datetime import date as DateType

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import local_today
from app.api.deps import require_module
from app.crud.activity import log_activity
from app.db.session import get_db
from app.models.finance import Expense, ResidenceSettings
from app.models.kitchen import CostCenter, FoodInventory
from app.models.purchasing import (
    Grn,
    GrnLine,
    Inventory,
    ItemMaster,
    PoLine,
    PrTemplate,
    PrTemplateLine,
    PurchaseOrder,
    PurchaseRequest,
    PurchaseRequestLine,
    Supplier,
)
from app.models.user import User
from app.services import audit, stock, workflow
from app.services.codes import next_code as _next_code
from app.services.pdf import logo_data_uri, render_pdf

router = APIRouter(prefix="/purchasing", tags=["purchasing"])
purchasing_access = require_module("purchasing")
# Separate router, same prefix as ItemMaster's generic (read_only) router in
# generic_routes.py — that one serves GET, this one hand-writes POST so
# `code` is always server-generated, never taken from the client.
item_master_router = APIRouter(prefix="/item-master", tags=["purchasing"])


# --------------------------------------------------------- purchase requests
class PurchaseRequestLineIn(BaseModel):
    # Every line is a catalog item. Name, unit, category and price come from
    # the Item Master, so nothing priced or named by the requester can be sent.
    item_master_id: uuid.UUID
    qty: float
    description: str | None = Field(default=None, max_length=300)


class PurchaseRequestLineOut(BaseModel):
    id: uuid.UUID
    item_master_id: uuid.UUID | None
    item_name: str
    qty: float
    unit: str
    category: str
    description: str | None
    est_unit_price: float
    est_cost: float


class PurchaseRequestIn(BaseModel):
    urgency: str = "Medium"
    note: str | None = None
    cost_center: str
    required_delivery_date: date
    lines: list[PurchaseRequestLineIn]
    # False = save as a Draft that can still be edited before submitting.
    submit: bool = True


class PurchaseRequestOut(BaseModel):
    id: uuid.UUID
    code: str
    request_date: date
    required_delivery_date: date | None
    status: str
    urgency: str
    requested_by: uuid.UUID | None
    requested_by_name: str | None
    approved_by_name: str | None
    note: str | None
    cost_center: str | None
    cost_center_id: uuid.UUID | None
    lines: list[PurchaseRequestLineOut]
    total_est_cost: float
    po_codes: list[str]


async def _pr_out(db: AsyncSession, pr: PurchaseRequest) -> PurchaseRequestOut:
    result = await db.execute(select(PurchaseRequestLine).where(PurchaseRequestLine.pr_id == pr.id))
    lines = [
        PurchaseRequestLineOut(
            id=l.id, item_master_id=l.item_master_id, item_name=l.item_name,
            qty=float(l.qty), unit=l.unit, category=l.category, description=l.description,
            est_unit_price=float(l.est_unit_price), est_cost=float(l.est_cost),
        )
        for l in result.scalars().all()
    ]
    names = {}
    ids = {i for i in (pr.requested_by, pr.approved_by) if i}
    if ids:
        names = dict((await db.execute(select(User.id, User.name).where(User.id.in_(ids)))).all())
    po_codes = (
        await db.execute(select(PurchaseOrder.code).where(PurchaseOrder.source_pr_id == pr.id).order_by(PurchaseOrder.code))
    ).scalars().all()
    return PurchaseRequestOut(
        id=pr.id, code=pr.code, request_date=pr.request_date, required_delivery_date=pr.required_delivery_date,
        status=pr.status, urgency=pr.urgency, requested_by=pr.requested_by,
        requested_by_name=names.get(pr.requested_by), approved_by_name=names.get(pr.approved_by),
        note=pr.note, cost_center=pr.cost_center, cost_center_id=pr.cost_center_id, lines=lines,
        total_est_cost=round(sum(l.est_cost for l in lines), 2), po_codes=list(po_codes),
    )


async def _pr_line_values(db: AsyncSession, line: PurchaseRequestLineIn) -> dict:
    """The indicative price is the item's last purchase price (what the last
    goods receipt actually paid), falling back to the stock's average cost for
    an item never bought. It is informational: the supplier price is set on
    the purchase order, and the final cost is what the GRN records."""
    item = await db.get(ItemMaster, line.item_master_id)
    if not item or not item.active:
        raise HTTPException(400, "Choose an active item from the Item Master")
    if line.qty <= 0:
        raise HTTPException(400, f"Quantity for {item.name} must be greater than zero")
    category, avg_price = await _stock_lookup(db, item.stock_type, item.stock_id)
    price = float(item.last_price) if float(item.last_price or 0) > 0 else avg_price
    return {
        "item_master_id": item.id, "item_name": item.name, "qty": line.qty, "unit": item.uom,
        "category": category, "description": (line.description or "").strip() or None,
        "est_unit_price": round(price, 3), "est_cost": round(line.qty * price, 2),
    }


async def _named_cost_center(db: AsyncSession, label: str) -> CostCenter:
    """PRs carry the cost center's label from the picker; resolve it to the
    real record so it can follow the request through ordering and receiving."""
    cc = (await db.execute(select(CostCenter).where(CostCenter.label == label))).scalar_one_or_none()
    if not cc:
        raise HTTPException(400, f"Unknown cost center '{label}'")
    return cc


async def _pr_decide(db: AsyncSession, pr: PurchaseRequest, user: User, action: str, reason: str | None = None) -> str:
    return await workflow.apply_action(db, workflow.get_doctype("purchase_request"), pr, action, user, reason)


@router.get("/purchase-requests", response_model=list[PurchaseRequestOut])
async def list_purchase_requests(
    db: AsyncSession = Depends(get_db), _user: User = Depends(purchasing_access)
):
    result = await db.execute(select(PurchaseRequest).order_by(PurchaseRequest.request_date.desc(), PurchaseRequest.code.desc()))
    return [await _pr_out(db, pr) for pr in result.scalars().all()]


@router.get("/purchase-requests/{pr_id}", response_model=PurchaseRequestOut)
async def get_purchase_request(
    pr_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(purchasing_access)
):
    pr = await db.get(PurchaseRequest, pr_id)
    if not pr:
        raise HTTPException(404, "Purchase request not found")
    return await _pr_out(db, pr)


@router.post("/purchase-requests", response_model=PurchaseRequestOut, status_code=201)
async def create_purchase_request(
    payload: PurchaseRequestIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(purchasing_access),
):
    if not payload.lines:
        raise HTTPException(400, "A purchase request needs at least one line item")
    values = [await _pr_line_values(db, l) for l in payload.lines]
    cc = await _named_cost_center(db, payload.cost_center)
    pr = PurchaseRequest(
        code=await _next_code(db, PurchaseRequest, "PR", 3001),
        request_date=local_today(), required_delivery_date=payload.required_delivery_date, status=workflow.DRAFT,
        urgency=payload.urgency, note=payload.note, cost_center=cc.label, cost_center_id=cc.id, requested_by=user.id,
    )
    db.add(pr)
    await db.flush()
    for v in values:
        db.add(PurchaseRequestLine(pr_id=pr.id, **v))
    await audit.record(db, user, "purchase_request", pr.id, pr.code, "create", to_status=workflow.DRAFT)
    if payload.submit:
        await _pr_decide(db, pr, user, "submit")
    await db.commit()
    await db.refresh(pr)
    return await _pr_out(db, pr)


@router.put("/purchase-requests/{pr_id}", response_model=PurchaseRequestOut)
async def update_purchase_request(
    pr_id: uuid.UUID,
    payload: PurchaseRequestIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(purchasing_access),
):
    """Only a Draft can be edited; anything else must be reopened first."""
    pr = await db.get(PurchaseRequest, pr_id)
    if not pr:
        raise HTTPException(404, "Purchase request not found")
    workflow.ensure_editable(pr, user)
    if not payload.lines:
        raise HTTPException(400, "A purchase request needs at least one line item")
    values = [await _pr_line_values(db, l) for l in payload.lines]
    cc = await _named_cost_center(db, payload.cost_center)
    pr.urgency, pr.note, pr.cost_center, pr.cost_center_id = payload.urgency, payload.note, cc.label, cc.id
    pr.required_delivery_date = payload.required_delivery_date
    await db.execute(delete(PurchaseRequestLine).where(PurchaseRequestLine.pr_id == pr.id))
    for v in values:
        db.add(PurchaseRequestLine(pr_id=pr.id, **v))
    await audit.record(db, user, "purchase_request", pr.id, pr.code, "edit", from_status=pr.status, to_status=pr.status)
    if payload.submit:
        await _pr_decide(db, pr, user, "submit")
    await db.commit()
    await db.refresh(pr)
    return await _pr_out(db, pr)


@router.delete("/purchase-requests/{pr_id}", status_code=204)
async def delete_purchase_request(
    pr_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(purchasing_access)
):
    pr = await db.get(PurchaseRequest, pr_id)
    if not pr:
        raise HTTPException(404, "Purchase request not found")
    workflow.ensure_editable(pr, user)
    await db.execute(delete(PurchaseRequestLine).where(PurchaseRequestLine.pr_id == pr.id))
    await log_activity(db, user, "Deleted draft purchase request", pr.code)
    await db.delete(pr)
    await db.commit()


@router.post("/purchase-requests/{pr_id}/decision", response_model=PurchaseRequestOut)
async def decide_purchase_request(
    pr_id: uuid.UUID,
    approve: bool,
    reason: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(purchasing_access),
):
    """Approve or reject a Submitted request (status-guarded by the workflow
    engine, so a decided request can't be flipped again)."""
    pr = await db.get(PurchaseRequest, pr_id)
    if not pr:
        raise HTTPException(404, "Purchase request not found")
    await _pr_decide(db, pr, user, "approve" if approve else "reject", None if approve else (reason or "Rejected"))
    await db.commit()
    await db.refresh(pr)
    return await _pr_out(db, pr)


# --------------------------------------------------------------- PR templates
class PrTemplateLineIn(BaseModel):
    item_master_id: uuid.UUID
    description: str | None = Field(default=None, max_length=300)


class PrTemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    lines: list[PrTemplateLineIn]


class PrTemplateLineOut(BaseModel):
    item_master_id: uuid.UUID
    item_name: str
    unit: str
    description: str | None


class PrTemplateOut(BaseModel):
    id: uuid.UUID
    name: str
    lines: list[PrTemplateLineOut]


async def _template_out(db: AsyncSession, t: PrTemplate) -> PrTemplateOut:
    rows = (
        await db.execute(
            select(PrTemplateLine, ItemMaster)
            .join(ItemMaster, ItemMaster.id == PrTemplateLine.item_master_id)
            .where(PrTemplateLine.template_id == t.id)
            .order_by(PrTemplateLine.sort_order)
        )
    ).all()
    return PrTemplateOut(
        id=t.id, name=t.name,
        lines=[
            PrTemplateLineOut(item_master_id=im.id, item_name=im.name, unit=im.uom, description=l.description)
            for l, im in rows
        ],
    )


async def _save_template(db: AsyncSession, t: PrTemplate, payload: PrTemplateIn) -> None:
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Give the template a name")
    if not payload.lines:
        raise HTTPException(400, "A template needs at least one item")
    if len({l.item_master_id for l in payload.lines}) != len(payload.lines):
        raise HTTPException(400, "An item can only appear once in a template")
    clash = (await db.execute(select(PrTemplate.id).where(func.lower(PrTemplate.name) == name.lower(), PrTemplate.id != t.id))).first()
    if clash:
        raise HTTPException(400, f"A template named '{name}' already exists")
    for l in payload.lines:
        item = await db.get(ItemMaster, l.item_master_id)
        if not item or not item.active:
            raise HTTPException(400, "Choose active items from the Item Master")
    t.name = name
    db.add(t)
    await db.flush()
    await db.execute(delete(PrTemplateLine).where(PrTemplateLine.template_id == t.id))
    for i, l in enumerate(payload.lines):
        db.add(PrTemplateLine(
            template_id=t.id, item_master_id=l.item_master_id, sort_order=i,
            description=(l.description or "").strip() or None,
        ))


@router.get("/pr-templates", response_model=list[PrTemplateOut])
async def list_pr_templates(db: AsyncSession = Depends(get_db), _user: User = Depends(purchasing_access)):
    templates = (await db.execute(select(PrTemplate).order_by(PrTemplate.name))).scalars().all()
    return [await _template_out(db, t) for t in templates]


@router.post("/pr-templates", response_model=PrTemplateOut, status_code=201)
async def create_pr_template(
    payload: PrTemplateIn, db: AsyncSession = Depends(get_db), user: User = Depends(purchasing_access)
):
    t = PrTemplate(name="", created_by=user.id)
    await _save_template(db, t, payload)
    await log_activity(db, user, "Saved PR template", t.name)
    await db.commit()
    return await _template_out(db, t)


@router.put("/pr-templates/{template_id}", response_model=PrTemplateOut)
async def update_pr_template(
    template_id: uuid.UUID, payload: PrTemplateIn, db: AsyncSession = Depends(get_db), user: User = Depends(purchasing_access)
):
    t = await db.get(PrTemplate, template_id)
    if not t:
        raise HTTPException(404, "Template not found")
    await _save_template(db, t, payload)
    await log_activity(db, user, "Updated PR template", t.name)
    await db.commit()
    return await _template_out(db, t)


@router.delete("/pr-templates/{template_id}", status_code=204)
async def delete_pr_template(
    template_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(purchasing_access)
):
    t = await db.get(PrTemplate, template_id)
    if not t:
        raise HTTPException(404, "Template not found")
    await log_activity(db, user, "Deleted PR template", t.name)
    await db.delete(t)
    await db.commit()


# ----------------------------------------------------------- purchase orders
class PoLineIn(BaseModel):
    item_master_id: uuid.UUID | None = None
    name: str
    qty: float
    unit: str
    price: float
    last_price: float | None = None
    description: str | None = None


class PurchaseOrderIn(BaseModel):
    supplier_id: uuid.UUID
    expected_date: date | None = None
    source_pr_id: uuid.UUID | None = None
    cost_center_id: uuid.UUID | None = None
    lines: list[PoLineIn]


class PoLineOut(PoLineIn):
    id: uuid.UUID
    received_qty: float

    class Config:
        from_attributes = True


class PurchaseOrderOut(BaseModel):
    id: uuid.UUID
    code: str
    supplier_id: uuid.UUID
    status: str
    order_date: date
    expected_date: date | None
    total: float
    payment_status: str
    created_by: uuid.UUID | None
    approved_by: uuid.UUID | None
    source_pr_id: uuid.UUID | None
    source_pr_code: str | None
    cost_center_id: uuid.UUID | None
    cost_center: str | None
    # What was actually invoiced on goods receipts so far vs what the same
    # quantities would have cost at the ordered prices. The PO itself is never
    # rewritten; it stays the record of what was ordered.
    received_value: float
    price_variance: float
    lines: list[PoLineOut]

    class Config:
        from_attributes = True


async def _po_out(db: AsyncSession, po: PurchaseOrder) -> PurchaseOrderOut:
    result = await db.execute(select(PoLine).where(PoLine.po_id == po.id))
    lines = result.scalars().all()
    source_pr_code = None
    if po.source_pr_id:
        source_pr_code = await db.scalar(select(PurchaseRequest.code).where(PurchaseRequest.id == po.source_pr_id))
    cc_label = await db.scalar(select(CostCenter.label).where(CostCenter.id == po.cost_center_id)) if po.cost_center_id else None
    received_value, ordered_value = (
        await db.execute(
            select(
                func.coalesce(func.sum(GrnLine.received_qty * GrnLine.price), 0),
                func.coalesce(func.sum(GrnLine.received_qty * GrnLine.ordered_price), 0),
            )
            .join(Grn, Grn.id == GrnLine.grn_id)
            .where(Grn.po_id == po.id, Grn.status.in_([workflow.SUBMITTED, workflow.APPROVED, workflow.CLOSED]))
        )
    ).one()
    return PurchaseOrderOut(
        id=po.id,
        code=po.code,
        supplier_id=po.supplier_id,
        status=po.status,
        order_date=po.order_date,
        expected_date=po.expected_date,
        total=float(po.total),
        payment_status=po.payment_status,
        created_by=po.created_by,
        approved_by=po.approved_by,
        source_pr_id=po.source_pr_id,
        source_pr_code=source_pr_code,
        cost_center_id=po.cost_center_id,
        cost_center=cc_label,
        received_value=round(float(received_value), 2),
        price_variance=round(float(received_value) - float(ordered_value), 2),
        lines=[
            PoLineOut(
                id=line.id,
                item_master_id=line.item_master_id,
                name=line.name,
                qty=float(line.qty),
                unit=line.unit,
                price=float(line.price),
                last_price=float(line.last_price) if line.last_price is not None else None,
                received_qty=float(line.received_qty), description=line.description,
            )
            for line in lines
        ],
    )


@router.get("/purchase-orders/{po_id}/pdf")
async def po_pdf(
    po_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(purchasing_access)
):
    """Generated on every request rather than persisted — a PO's
    received_qty keeps changing after "Ordered" via GRNs, and created_by/
    approved_by are only known after certain lifecycle events, so a cached
    PDF would risk going stale. Re-rendering is cheap at this app's scale."""
    po = await db.get(PurchaseOrder, po_id)
    if not po:
        raise HTTPException(404, "Purchase order not found")
    lines = (await db.execute(select(PoLine).where(PoLine.po_id == po.id))).scalars().all()
    supplier = await db.get(Supplier, po.supplier_id)
    residence = (await db.execute(select(ResidenceSettings).limit(1))).scalar_one_or_none()
    created_by = await db.get(User, po.created_by) if po.created_by else None
    approved_by = await db.get(User, po.approved_by) if po.approved_by else None

    pdf_bytes = render_pdf(
        "po.html",
        {
            "po": {
                "code": po.code, "order_date": po.order_date, "expected_date": po.expected_date,
                "status": po.status, "payment_status": po.payment_status, "total": float(po.total),
            },
            "lines": [
                {"name": l.name, "description": l.description, "qty": float(l.qty), "unit": l.unit, "price": float(l.price),
                 "line_total": float(l.qty) * float(l.price)}
                for l in lines
            ],
            "supplier": {
                "name": supplier.name if supplier else "Unknown supplier",
                "contact": supplier.contact if supplier else None,
                "phone": supplier.phone if supplier else None,
                "email": supplier.email if supplier else None,
            },
            "residence": {
                "name": residence.name if residence else "Residence",
                "address": residence.address if residence else None,
                "phone": residence.phone if residence else None,
                "terms_and_conditions": residence.terms_and_conditions if residence else None,
            },
            "currency": residence.currency if residence else "KWD",
            "logo_data_uri": logo_data_uri(residence.logo_path) if residence else None,
            "created_by_name": created_by.name if created_by else None,
            "approved_by_name": approved_by.name if approved_by else None,
        },
    )
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{po.code}.pdf"'},
    )


# --------------------------------------------------------- item master --
class ItemMasterIn(BaseModel):
    name: str
    uom: str
    last_price: float = 0
    preferred_supplier_id: uuid.UUID | None = None
    active: bool = True
    stock_type: str  # food | general
    stock_id: uuid.UUID


class ItemMasterOut(ItemMasterIn):
    id: uuid.UUID
    code: str
    # Not columns on item_master — resolved live off the linked stock record
    # (food_inventory.category/.cost or inventory.category/.avg_price) so
    # category and par levels have exactly one source of truth: Stock.
    category: str
    avg_price: float
    created_at: datetime
    created_by_name: str | None

    class Config:
        from_attributes = True


async def _stock_lookup(db: AsyncSession, stock_type: str, stock_id: uuid.UUID) -> tuple[str, float]:
    if stock_type == "food":
        row = await db.get(FoodInventory, stock_id)
        return (row.category, float(row.cost)) if row else ("—", 0.0)
    row = await db.get(Inventory, stock_id)
    return (row.category, float(row.avg_price)) if row else ("—", 0.0)


def _item_master_out(item: ItemMaster, category: str, avg_price: float, created_by_name: str | None = None) -> ItemMasterOut:
    return ItemMasterOut(
        id=item.id, code=item.code, name=item.name, uom=item.uom, last_price=item.last_price,
        preferred_supplier_id=item.preferred_supplier_id, active=item.active,
        stock_type=item.stock_type, stock_id=item.stock_id, category=category, avg_price=avg_price,
        created_at=item.created_at, created_by_name=created_by_name,
    )


async def _next_item_code(db: AsyncSession) -> str:
    # Deliberately NOT reusing the shared _next_code helper: that one takes
    # the single max code across the WHOLE table regardless of prefix, which
    # would misfire here since item_master already has old rows using other
    # code schemes (from before this endpoint existed). Filtering to ITM-%
    # keeps this sequence independent of that history.
    result = await db.execute(
        select(ItemMaster.code).where(ItemMaster.code.like("ITM-%")).order_by(ItemMaster.code.desc()).limit(1)
    )
    last = result.scalar_one_or_none()
    if last:
        try:
            return f"ITM-{int(last.split('-')[1]) + 1}"
        except (IndexError, ValueError):
            pass
    return "ITM-1001"


@item_master_router.get("", response_model=list[ItemMasterOut])
async def list_item_master(db: AsyncSession = Depends(get_db), _user: User = Depends(purchasing_access)):
    """Hand-written (not generic CRUD) — needs to join each row to its stock
    record for category/avg_price, which generic_routes.py's factory can't
    express. Registered ahead of that module's router inclusion in main.py
    so this shadows it for GET; ItemMaster carries no generic registration
    at all anymore (see generic_routes.py)."""
    items = (await db.execute(select(ItemMaster).order_by(ItemMaster.name))).scalars().all()
    food_ids = {i.stock_id for i in items if i.stock_type == "food"}
    general_ids = {i.stock_id for i in items if i.stock_type == "general"}
    food_rows = {}
    if food_ids:
        result = await db.execute(select(FoodInventory).where(FoodInventory.id.in_(food_ids)))
        food_rows = {r.id: r for r in result.scalars().all()}
    general_rows = {}
    if general_ids:
        result = await db.execute(select(Inventory).where(Inventory.id.in_(general_ids)))
        general_rows = {r.id: r for r in result.scalars().all()}
    creator_ids = {i.created_by for i in items if i.created_by}
    creator_names = {}
    if creator_ids:
        result = await db.execute(select(User.id, User.name).where(User.id.in_(creator_ids)))
        creator_names = dict(result.all())

    out = []
    for item in items:
        row = (food_rows if item.stock_type == "food" else general_rows).get(item.stock_id)
        creator_name = creator_names.get(item.created_by)
        if row is None:
            out.append(_item_master_out(item, "—", 0.0, creator_name))
        else:
            avg_price = float(row.cost if item.stock_type == "food" else row.avg_price)
            out.append(_item_master_out(item, row.category, avg_price, creator_name))
    return out


@item_master_router.get("/{item_id}", response_model=ItemMasterOut)
async def get_item_master(
    item_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(purchasing_access)
):
    item = await db.get(ItemMaster, item_id)
    if not item:
        raise HTTPException(404, "Item master entry not found")
    category, avg_price = await _stock_lookup(db, item.stock_type, item.stock_id)
    creator_name = await db.scalar(select(User.name).where(User.id == item.created_by)) if item.created_by else None
    return _item_master_out(item, category, avg_price, creator_name)


@item_master_router.post("", response_model=ItemMasterOut, status_code=201)
async def create_item_master(
    payload: ItemMasterIn, db: AsyncSession = Depends(get_db), user: User = Depends(purchasing_access)
):
    """Hand-written (not generic CRUD) purely so `code` is always
    server-generated — see ItemMaster having no generic router registration
    at all (generic_routes.py) for why every item-master route lives here."""
    item = ItemMaster(
        code=await _next_item_code(db),
        created_by=user.id,
        **payload.model_dump(),
    )
    db.add(item)
    await log_activity(db, user, "Added item master entry", f"{payload.name} ({item.code})")
    await db.commit()
    await db.refresh(item)
    category, avg_price = await _stock_lookup(db, item.stock_type, item.stock_id)
    return _item_master_out(item, category, avg_price, user.name)


class ItemMasterTransactionOut(BaseModel):
    doc_type: str  # "Purchase Request" | "Purchase Order" | "Goods Received"
    code: str
    date: date
    status: str
    qty: float
    unit: str
    amount: float


@item_master_router.get("/{item_id}/transactions", response_model=list[ItemMasterTransactionOut])
async def item_master_transactions(
    item_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(purchasing_access)
):
    """Every PR line, PO line and GRN line that ever referenced this catalog
    item, newest first — the audit trail a buyer needs when asking "where
    has this item actually been ordered/received"."""
    item = await db.get(ItemMaster, item_id)
    if not item:
        raise HTTPException(404, "Item master entry not found")

    out: list[ItemMasterTransactionOut] = []

    pr_rows = (await db.execute(
        select(PurchaseRequestLine, PurchaseRequest)
        .join(PurchaseRequest, PurchaseRequest.id == PurchaseRequestLine.pr_id)
        .where(PurchaseRequestLine.item_master_id == item_id)
    )).all()
    for line, pr in pr_rows:
        out.append(ItemMasterTransactionOut(
            doc_type="Purchase Request", code=pr.code, date=pr.request_date, status=pr.status,
            qty=float(line.qty), unit=line.unit, amount=float(line.est_cost),
        ))

    po_rows = (await db.execute(
        select(PoLine, PurchaseOrder)
        .join(PurchaseOrder, PurchaseOrder.id == PoLine.po_id)
        .where(PoLine.item_master_id == item_id)
    )).all()
    for line, po in po_rows:
        out.append(ItemMasterTransactionOut(
            doc_type="Purchase Order", code=po.code, date=po.order_date, status=po.status,
            qty=float(line.qty), unit=line.unit, amount=float(line.qty) * float(line.price),
        ))

    grn_rows = (await db.execute(
        select(GrnLine, Grn)
        .join(Grn, Grn.id == GrnLine.grn_id)
        .join(PoLine, PoLine.id == GrnLine.po_line_id)
        .where(PoLine.item_master_id == item_id)
    )).all()
    for line, grn in grn_rows:
        out.append(ItemMasterTransactionOut(
            doc_type="Goods Received", code=grn.code, date=grn.date, status="Received",
            qty=float(line.received_qty), unit=line.unit, amount=float(line.received_qty) * float(line.price),
        ))

    out.sort(key=lambda t: t.date, reverse=True)
    return out


class ItemMasterPatch(BaseModel):
    # stock_type/stock_id aren't here — repointing an item master entry at a
    # different stock record is a much bigger operation than editing its
    # catalog fields, and nothing asked for it.
    name: str | None = None
    uom: str | None = None
    last_price: float | None = None
    preferred_supplier_id: uuid.UUID | None = None
    active: bool | None = None


@item_master_router.patch("/{item_id}", response_model=ItemMasterOut)
async def update_item_master(
    item_id: uuid.UUID, payload: ItemMasterPatch, db: AsyncSession = Depends(get_db), user: User = Depends(purchasing_access)
):
    item = await db.get(ItemMaster, item_id)
    if not item:
        raise HTTPException(404, "Item master entry not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    await log_activity(db, user, "Updated item master entry", f"{item.name} ({item.code})")
    await db.commit()
    await db.refresh(item)
    category, avg_price = await _stock_lookup(db, item.stock_type, item.stock_id)
    return _item_master_out(item, category, avg_price)


@router.get("/purchase-orders", response_model=list[PurchaseOrderOut])
async def list_purchase_orders(
    db: AsyncSession = Depends(get_db), _user: User = Depends(purchasing_access)
):
    result = await db.execute(select(PurchaseOrder).order_by(PurchaseOrder.order_date.desc()))
    return [await _po_out(db, po) for po in result.scalars().all()]


@router.post("/purchase-orders", response_model=PurchaseOrderOut, status_code=201)
async def create_purchase_order(
    payload: PurchaseOrderIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(purchasing_access),
):
    total = sum(line.qty * line.price for line in payload.lines)
    po = PurchaseOrder(
        code=await _next_code(db, PurchaseOrder, "PO", 1001),
        supplier_id=payload.supplier_id,
        status=workflow.DRAFT,
        order_date=local_today(),
        cost_center_id=payload.cost_center_id,
        expected_date=payload.expected_date,
        total=total,
        payment_status="Unpaid",
        source_pr_id=payload.source_pr_id,
        created_by=user.id,
    )
    db.add(po)
    await db.flush()
    for line in payload.lines:
        db.add(PoLine(po_id=po.id, **line.model_dump()))
    await log_activity(db, user, "Created purchase order", f"{po.code} — total {total:.2f}")
    await audit.record(db, user, "purchase_order", po.id, po.code, "create", to_status=workflow.DRAFT)
    await workflow.apply_action(db, workflow.get_doctype("purchase_order"), po, "submit", user)
    await db.commit()
    await db.refresh(po)
    return await _po_out(db, po)


async def decide_po(db: AsyncSession, po: PurchaseOrder, user: User, approve: bool, reason: str | None = None) -> str:
    """The single place a PO's approval decision is applied — called from
    both this module's own decision endpoint AND approvals.py's unified
    inbox, so both go through the same status-guarded workflow."""
    return await workflow.apply_action(
        db, workflow.get_doctype("purchase_order"), po, "approve" if approve else "reject", user,
        None if approve else (reason or "Rejected"),
    )


@router.post("/purchase-orders/{po_id}/decision", response_model=PurchaseOrderOut)
async def decide_purchase_order(
    po_id: uuid.UUID,
    approve: bool,
    reason: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(purchasing_access),
):
    po = await db.get(PurchaseOrder, po_id)
    if not po:
        raise HTTPException(404, "Purchase order not found")
    await decide_po(db, po, user, approve, reason)
    await db.commit()
    await db.refresh(po)
    return await _po_out(db, po)


class SpendRow(BaseModel):
    key: str
    label: str
    unit: str | None  # only for the per-item grouping
    qty: float | None
    grn_count: int
    value: float
    price_variance: float


class SpendReport(BaseModel):
    rows: list[SpendRow]
    total_value: float
    total_variance: float
    note: str


@router.get("/spend", response_model=SpendReport)
async def purchase_spend(
    group_by: str = "month",
    date_from: date | None = None,
    date_to: date | None = None,
    supplier_id: uuid.UUID | None = None,
    cost_center_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(purchasing_access),
):
    """What was bought: goods receipts (Submitted or later) valued at the
    price actually invoiced, grouped by month, supplier, receiving cost
    center or item. The GRN is where purchases take financial effect."""
    receipt_date = Grn.date
    keys = {
        "month": (func.to_char(receipt_date, "YYYY-MM"), func.to_char(receipt_date, "YYYY-MM")),
        "supplier": (Supplier.name, Supplier.name),
        "cost_center": (CostCenter.label, CostCenter.label),
        "item": (GrnLine.name, GrnLine.name),
    }
    if group_by not in keys:
        raise HTTPException(400, "group_by must be month, supplier, cost_center or item")
    key_col, label_col = keys[group_by]
    stmt = (
        select(
            key_col, label_col, func.min(GrnLine.unit), func.sum(GrnLine.received_qty), func.count(func.distinct(Grn.id)),
            func.sum(GrnLine.received_qty * GrnLine.price), func.sum(GrnLine.received_qty * (GrnLine.price - GrnLine.ordered_price)),
        )
        .select_from(GrnLine).join(Grn, Grn.id == GrnLine.grn_id)
        .join(Supplier, Supplier.id == Grn.supplier_id).join(CostCenter, CostCenter.id == Grn.receiving_cost_center_id)
        .where(Grn.status.in_([workflow.SUBMITTED, workflow.APPROVED, workflow.CLOSED]))
        .group_by(key_col, label_col).order_by(key_col.desc() if group_by == "month" else func.sum(GrnLine.received_qty * GrnLine.price).desc())
    )
    if date_from:
        stmt = stmt.where(Grn.date >= date_from)
    if date_to:
        stmt = stmt.where(Grn.date <= date_to)
    if supplier_id:
        stmt = stmt.where(Grn.supplier_id == supplier_id)
    if cost_center_id:
        stmt = stmt.where(Grn.receiving_cost_center_id == cost_center_id)
    rows = [
        SpendRow(
            key=str(k), label=str(lbl), unit=unit if group_by == "item" else None,
            qty=round(float(qty), 3) if group_by == "item" else None, grn_count=int(n),
            value=round(float(v), 2), price_variance=round(float(var), 2),
        )
        for k, lbl, unit, qty, n, v, var in (await db.execute(stmt)).all()
    ]
    return SpendReport(
        rows=rows, total_value=round(sum(r.value for r in rows), 2), total_variance=round(sum(r.price_variance for r in rows), 2),
        note="Goods receipts valued at the invoiced price (actual cost). Draft receipts are excluded.",
    )


class PriceHistoryEntry(BaseModel):
    supplier_id: uuid.UUID
    supplier_name: str
    date: DateType
    unit_price: float
    po_code: str


# Orders that actually went to a supplier; drafts and rejected ones say
# nothing about what was paid.
PO_PLACED = ("Approved", "Partially Received", "Fully Received", "Closed")


@router.get("/price-history", response_model=dict[uuid.UUID, list[PriceHistoryEntry]])
async def price_history(
    item_ids: list[uuid.UUID] = Query(default=[]),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(purchasing_access),
):
    """Last three purchases per item, preferring different suppliers so the
    buyer sees a real price comparison; if fewer than three suppliers have
    sold the item, the gap is filled with the most recent repeat purchases."""
    if not item_ids:
        return {}
    rows = (
        await db.execute(
            select(PoLine.item_master_id, PoLine.price, PurchaseOrder.order_date, PurchaseOrder.code, Supplier.id, Supplier.name)
            .join(PurchaseOrder, PurchaseOrder.id == PoLine.po_id)
            .join(Supplier, Supplier.id == PurchaseOrder.supplier_id)
            .where(PoLine.item_master_id.in_(item_ids), PurchaseOrder.status.in_(PO_PLACED))
            .order_by(PurchaseOrder.order_date.desc(), PurchaseOrder.code.desc())
        )
    ).all()
    by_item: dict[uuid.UUID, list[PriceHistoryEntry]] = {}
    seen: dict[uuid.UUID, set[uuid.UUID]] = {}
    spare: dict[uuid.UUID, list[PriceHistoryEntry]] = {}
    for item_id, price, order_date, po_code, supplier_id, supplier_name in rows:
        entry = PriceHistoryEntry(
            supplier_id=supplier_id, supplier_name=supplier_name, date=order_date, unit_price=float(price), po_code=po_code
        )
        picked = by_item.setdefault(item_id, [])
        if supplier_id not in seen.setdefault(item_id, set()) and len(picked) < 3:
            picked.append(entry)
            seen[item_id].add(supplier_id)
        else:
            spare.setdefault(item_id, []).append(entry)
    for item_id, picked in by_item.items():
        picked.extend(spare.get(item_id, [])[: 3 - len(picked)])
        picked.sort(key=lambda e: e.date, reverse=True)
    return by_item


class SupplierPriceCell(BaseModel):
    latest_price: float
    latest_date: date
    avg_price: float
    min_price: float
    max_price: float
    purchases: int
    total_qty: float


class ComparisonSupplier(BaseModel):
    id: uuid.UUID
    name: str


class ComparisonItem(BaseModel):
    item_master_id: uuid.UUID
    name: str
    unit: str
    cells: dict[uuid.UUID, SupplierPriceCell]
    cheapest_supplier_id: uuid.UUID | None  # lowest latest price, only when 2+ suppliers


class PriceComparison(BaseModel):
    suppliers: list[ComparisonSupplier]
    items: list[ComparisonItem]


@router.get("/price-comparison", response_model=PriceComparison)
async def price_comparison(
    date_from: date | None = None,
    date_to: date | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(purchasing_access),
):
    """Read-only: for each catalog item, what each supplier charged on the
    purchase orders actually placed with them, side by side. Nothing is
    stored or changed; it only reads existing orders."""
    stmt = (
        select(
            PoLine.item_master_id, ItemMaster.name, ItemMaster.uom, Supplier.id, Supplier.name,
            PoLine.price, PoLine.qty, PurchaseOrder.order_date, PurchaseOrder.code,
        )
        .join(PurchaseOrder, PurchaseOrder.id == PoLine.po_id)
        .join(Supplier, Supplier.id == PurchaseOrder.supplier_id)
        .join(ItemMaster, ItemMaster.id == PoLine.item_master_id)
        .where(PoLine.item_master_id.is_not(None), PurchaseOrder.status.in_(PO_PLACED))
        .order_by(PurchaseOrder.order_date.desc(), PurchaseOrder.code.desc())
    )
    if date_from:
        stmt = stmt.where(PurchaseOrder.order_date >= date_from)
    if date_to:
        stmt = stmt.where(PurchaseOrder.order_date <= date_to)
    items: dict[uuid.UUID, dict] = {}
    suppliers: dict[uuid.UUID, str] = {}
    for item_id, item_name, unit, sup_id, sup_name, price, qty, order_date, _code in (await db.execute(stmt)).all():
        suppliers[sup_id] = sup_name
        item = items.setdefault(item_id, {"name": item_name, "unit": unit, "rows": {}})
        item["rows"].setdefault(sup_id, []).append((float(price), float(qty), order_date))  # newest first
    out = []
    for item_id, item in sorted(items.items(), key=lambda kv: kv[1]["name"].lower()):
        cells = {}
        for sup_id, rows in item["rows"].items():
            prices = [r[0] for r in rows]
            cells[sup_id] = SupplierPriceCell(
                latest_price=prices[0], latest_date=rows[0][2], avg_price=round(sum(prices) / len(prices), 3),
                min_price=min(prices), max_price=max(prices), purchases=len(rows), total_qty=round(sum(r[1] for r in rows), 3),
            )
        cheapest = min(cells, key=lambda k: cells[k].latest_price) if len(cells) > 1 else None
        out.append(ComparisonItem(item_master_id=item_id, name=item["name"], unit=item["unit"], cells=cells, cheapest_supplier_id=cheapest))
    return PriceComparison(
        suppliers=[ComparisonSupplier(id=i, name=n) for i, n in sorted(suppliers.items(), key=lambda kv: kv[1].lower())],
        items=out,
    )


class ConvertPrLineIn(BaseModel):
    pr_line_id: uuid.UUID
    price: float


class ConvertPrGroupIn(BaseModel):
    supplier_id: uuid.UUID
    expected_date: date | None = None
    lines: list[ConvertPrLineIn]


class ConvertPrToPoIn(BaseModel):
    # One PO per group — the frontend groups the PR's lines by each item's
    # preferred supplier (Odoo's own behavior for a multi-vendor request);
    # a line with no preferred supplier goes in a group the user assigned
    # a supplier to manually. Price is per-line, not per-request, since
    # different items cost different amounts.
    groups: list[ConvertPrGroupIn]


@router.post("/purchase-requests/{pr_id}/convert-to-po", response_model=list[PurchaseOrderOut])
async def convert_pr_to_po(
    pr_id: uuid.UUID,
    payload: ConvertPrToPoIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(purchasing_access),
):
    pr = await db.get(PurchaseRequest, pr_id)
    if not pr:
        raise HTTPException(404, "Purchase request not found")
    if pr.status != workflow.APPROVED:
        raise HTTPException(400, "Only an approved purchase request can be converted to an order")
    if not payload.groups:
        raise HTTPException(400, "At least one supplier group is required")

    pr_lines = {
        l.id: l for l in (
            await db.execute(select(PurchaseRequestLine).where(PurchaseRequestLine.pr_id == pr_id))
        ).scalars().all()
    }
    covered = {g.pr_line_id for group in payload.groups for g in group.lines}
    if covered != set(pr_lines.keys()):
        raise HTTPException(400, "Every item in the request must be included in a supplier group")

    created_pos = []
    po_codes = []
    for group in payload.groups:
        if not group.lines:
            continue
        total = sum(g.price * float(pr_lines[g.pr_line_id].qty) for g in group.lines)
        po = PurchaseOrder(
            code=await _next_code(db, PurchaseOrder, "PO", 1001),
            supplier_id=group.supplier_id,
            # Every order needs its own approval, whatever the total.
            status=workflow.DRAFT,
            order_date=local_today(),
            expected_date=group.expected_date,
            total=total,
            payment_status="Unpaid",
            source_pr_id=pr.id,
            cost_center_id=pr.cost_center_id,
            created_by=user.id,
        )
        db.add(po)
        await db.flush()
        await audit.record(db, user, "purchase_order", po.id, po.code, "create", to_status=workflow.DRAFT,
                           reason=f"Converted from {pr.code}")
        for g in group.lines:
            line = pr_lines[g.pr_line_id]
            db.add(PoLine(
                po_id=po.id, item_master_id=line.item_master_id, name=line.item_name,
                qty=float(line.qty), unit=line.unit, price=g.price, last_price=g.price,
                description=line.description,
            ))
        await workflow.apply_action(db, workflow.get_doctype("purchase_order"), po, "submit", user)
        created_pos.append(po)
        po_codes.append(po.code)

    pr.status, pr.closed_by, pr.closed_at = workflow.CLOSED, user.id, datetime.now(timezone.utc)
    await audit.record(db, user, "purchase_request", pr.id, pr.code, "convert", from_status=workflow.APPROVED,
                       to_status=workflow.CLOSED, reason=f"Ordered as {', '.join(po_codes)}")
    await log_activity(db, user, "Created purchase order(s)", f"{', '.join(po_codes)} from {len(pr_lines)} item(s)")
    await db.commit()
    return [await _po_out(db, po) for po in created_pos]


# -------------------------------------------------------------------- GRNs --
class GrnLineIn(BaseModel):
    po_line_id: uuid.UUID
    received_qty: float
    # What was actually invoiced/paid for this receipt, if it differs from
    # the PO's ordered price — e.g. the supplier's price went up or down
    # between ordering and delivery. Omitted (or equal to the PO price)
    # means "received exactly as ordered, no adjustment". The PurchaseOrder
    # itself is never rewritten — it stays the historical record of what
    # was ordered; this is what actually happened at receiving.
    actual_price: float | None = None
    # Food items only — creates a new batch lot for FEFO tracking instead of
    # blending into a single stock figure. Ignored for general (non-food)
    # PO lines, which have no batch ledger.
    expiry: date | None = None
    batch_label: str | None = None


class GrnIn(BaseModel):
    po_id: uuid.UUID
    receiving_cost_center_id: uuid.UUID
    date: DateType | None = None
    notes: str | None = None
    lines: list[GrnLineIn]
    # Why the invoiced price differs from the order; required to submit when it does.
    variance_note: str | None = None
    supplier_invoice_no: str | None = Field(default=None, max_length=60)
    # True = create and submit in one step (stock is posted immediately);
    # False = save as a Draft with no stock effect.
    submit: bool = False


class GrnLineOut(BaseModel):
    id: uuid.UUID
    po_line_id: uuid.UUID | None
    name: str
    ordered_qty: float
    received_qty: float
    unit: str
    ordered_price: float
    price: float
    line_total: float
    variance: float  # (actual - ordered price) x received quantity
    expiry: date | None
    batch_label: str | None


class GrnOut(BaseModel):
    id: uuid.UUID
    code: str
    status: str
    po_id: uuid.UUID
    po_code: str | None
    supplier_id: uuid.UUID
    supplier_name: str | None
    date: date
    receiving_cost_center_id: uuid.UUID
    receiving_cost_center: str
    notes: str | None
    total: float
    variance_total: float
    has_variance: bool
    variance_note: str | None
    supplier_invoice_no: str | None
    received_by_name: str | None = None
    submitted_by_name: str | None = None
    submitted_at: datetime | None = None
    approved_by_name: str | None = None
    approved_at: datetime | None = None
    closed_by_name: str | None = None
    closed_at: datetime | None = None
    lines: list[GrnLineOut]


# A PO can be received against while it is open: freshly ordered, or already
# partly received. (Phase B renames these to the standard workflow words.)
PO_RECEIVABLE = ("Approved", "Partially Received")
EPS = 0.0005


async def _grn_outs(db: AsyncSession, grns: list[Grn]) -> list[GrnOut]:
    if not grns:
        return []
    labels = {cc.id: cc.label for cc in (await db.execute(select(CostCenter))).scalars().all()}
    po_codes = {
        po_id: code
        for po_id, code in (
            await db.execute(select(PurchaseOrder.id, PurchaseOrder.code).where(PurchaseOrder.id.in_({g.po_id for g in grns})))
        ).all()
    }
    suppliers = {s.id: s.name for s in (await db.execute(select(Supplier))).scalars().all()}
    user_ids = set()
    for g in grns:
        user_ids.update({g.received_by, g.submitted_by, g.approved_by, g.closed_by})
    user_ids.discard(None)
    names = dict((await db.execute(select(User.id, User.name).where(User.id.in_(user_ids)))).all()) if user_ids else {}
    lines = (await db.execute(select(GrnLine).where(GrnLine.grn_id.in_([g.id for g in grns])))).scalars().all()
    by_grn: dict[uuid.UUID, list[GrnLine]] = {}
    for line in lines:
        by_grn.setdefault(line.grn_id, []).append(line)
    out = []
    for g in grns:
        gl = [
            GrnLineOut(
                id=l.id, po_line_id=l.po_line_id, name=l.name, ordered_qty=float(l.ordered_qty),
                received_qty=float(l.received_qty), unit=l.unit, ordered_price=float(l.ordered_price),
                price=float(l.price), line_total=round(float(l.received_qty) * float(l.price), 3),
                variance=round(float(l.received_qty) * (float(l.price) - float(l.ordered_price)), 3),
                expiry=l.expiry, batch_label=l.batch_label,
            )
            for l in by_grn.get(g.id, [])
        ]
        out.append(
            GrnOut(
                id=g.id, code=g.code, status=g.status, po_id=g.po_id, po_code=po_codes.get(g.po_id),
                supplier_id=g.supplier_id, supplier_name=suppliers.get(g.supplier_id), date=g.date,
                receiving_cost_center_id=g.receiving_cost_center_id,
                receiving_cost_center=labels.get(g.receiving_cost_center_id, "-"), notes=g.notes,
                total=round(sum(l.line_total for l in gl), 2),
                variance_total=round(sum(l.variance for l in gl), 2),
                has_variance=any(abs(l.price - l.ordered_price) > EPS for l in gl), variance_note=g.variance_note,
                supplier_invoice_no=g.supplier_invoice_no,
                received_by_name=names.get(g.received_by),
                submitted_by_name=names.get(g.submitted_by), submitted_at=g.submitted_at,
                approved_by_name=names.get(g.approved_by), approved_at=g.approved_at,
                closed_by_name=names.get(g.closed_by), closed_at=g.closed_at, lines=gl,
            )
        )
    return out


async def _validate_grn(db: AsyncSession, payload: GrnIn) -> tuple[PurchaseOrder, list[tuple[PoLine, GrnLineIn]]]:
    po = await db.get(PurchaseOrder, payload.po_id)
    if not po:
        raise HTTPException(404, "Purchase order not found")
    if po.status not in PO_RECEIVABLE:
        raise HTTPException(400, f"This purchase order is {po.status} and cannot receive goods")
    if not await db.get(CostCenter, payload.receiving_cost_center_id):
        raise HTTPException(400, "Select a receiving cost center")
    if not payload.lines:
        raise HTTPException(400, "Enter a received quantity for at least one item")
    resolved = []
    for line_in in payload.lines:
        po_line = await db.get(PoLine, line_in.po_line_id)
        if not po_line or po_line.po_id != po.id:
            raise HTTPException(400, f"PO line {line_in.po_line_id} does not belong to this PO")
        if line_in.received_qty <= 0:
            raise HTTPException(400, "Received quantity must be greater than zero")
        remaining = float(po_line.qty) - float(po_line.received_qty)
        if line_in.received_qty > remaining + EPS:
            raise HTTPException(
                400, f"{po_line.name}: receiving {line_in.received_qty:g} exceeds the {remaining:g} still pending"
            )
        resolved.append((po_line, line_in))
    return po, resolved


async def _write_grn_lines(db: AsyncSession, grn: Grn, resolved) -> None:
    for po_line, line_in in resolved:
        ordered_price = float(po_line.price)
        db.add(
            GrnLine(
                grn_id=grn.id, po_line_id=po_line.id, name=po_line.name, ordered_qty=po_line.qty,
                received_qty=line_in.received_qty, unit=po_line.unit, ordered_price=ordered_price,
                price=line_in.actual_price if line_in.actual_price is not None else ordered_price,
                expiry=line_in.expiry, batch_label=line_in.batch_label,
            )
        )


async def _grn_snapshot(db: AsyncSession, grn: Grn) -> dict:
    cc = await db.get(CostCenter, grn.receiving_cost_center_id)
    lines = (await db.execute(select(GrnLine).where(GrnLine.grn_id == grn.id))).scalars().all()
    return {
        "date": grn.date.isoformat(), "cost_center": cc.label if cc else None, "notes": grn.notes,
        "supplier_invoice_no": grn.supplier_invoice_no,
        "lines": [{"item": l.name, "qty": float(l.received_qty), "price": float(l.price)} for l in lines],
    }


async def _refresh_po_status(db: AsyncSession, po: PurchaseOrder) -> None:
    lines = (await db.execute(select(PoLine).where(PoLine.po_id == po.id))).scalars().all()
    if po.status == workflow.CLOSED:
        return  # a Closed PO keeps its status even if a late receipt is reversed
    if all(float(l.received_qty) >= float(l.qty) - EPS for l in lines):
        po.status = "Fully Received"
    elif any(float(l.received_qty) > EPS for l in lines):
        po.status = "Partially Received"
    else:
        po.status = workflow.APPROVED


@router.get("/grns", response_model=list[GrnOut])
async def list_grns(db: AsyncSession = Depends(get_db), _user: User = Depends(purchasing_access)):
    result = await db.execute(select(Grn).order_by(Grn.date.desc(), Grn.code.desc()))
    return await _grn_outs(db, list(result.scalars().all()))


@router.get("/grns/{grn_id}", response_model=GrnOut)
async def get_grn(grn_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(purchasing_access)):
    grn = await db.get(Grn, grn_id)
    if not grn:
        raise HTTPException(404, "GRN not found")
    return (await _grn_outs(db, [grn]))[0]


@router.post("/grns", response_model=GrnOut, status_code=201)
async def receive_goods(
    payload: GrnIn, db: AsyncSession = Depends(get_db), user: User = Depends(purchasing_access)
):
    """Creates a GRN against a PO. With submit=true it is posted at once:
    stock is registered at the receiving cost center and the PO's received
    quantities move - the interlock that keeps purchasing and stock in step."""
    po, resolved = await _validate_grn(db, payload)
    grn = Grn(
        code=await _next_code(db, Grn, "GRN", 2001), po_id=po.id, supplier_id=po.supplier_id,
        date=payload.date or local_today(), receiving_cost_center_id=payload.receiving_cost_center_id,
        notes=payload.notes, variance_note=(payload.variance_note or "").strip() or None,
        supplier_invoice_no=(payload.supplier_invoice_no or "").strip() or None, received_by=user.id,
    )
    db.add(grn)
    await db.flush()
    await _write_grn_lines(db, grn, resolved)
    await audit.record(db, user, "grn", grn.id, grn.code, "create", to_status=workflow.DRAFT)
    await log_activity(db, user, "Created GRN", f"{grn.code} - {po.code}")
    if payload.submit:
        await db.flush()
        await workflow.apply_action(db, workflow.get_doctype("grn"), grn, "submit", user)
    await db.commit()
    return (await _grn_outs(db, [grn]))[0]


@router.put("/grns/{grn_id}", response_model=GrnOut)
async def update_grn(
    grn_id: uuid.UUID, payload: GrnIn, db: AsyncSession = Depends(get_db), user: User = Depends(purchasing_access)
):
    grn = await db.get(Grn, grn_id)
    if not grn:
        raise HTTPException(404, "GRN not found")
    workflow.ensure_editable(grn, user)
    if payload.po_id != grn.po_id:
        raise HTTPException(400, "A GRN cannot be moved to a different purchase order")
    _, resolved = await _validate_grn(db, payload)
    before = await _grn_snapshot(db, grn)
    grn.date, grn.receiving_cost_center_id, grn.notes = (
        payload.date or grn.date, payload.receiving_cost_center_id, payload.notes,
    )
    grn.variance_note = (payload.variance_note or "").strip() or None
    grn.supplier_invoice_no = (payload.supplier_invoice_no or "").strip() or None
    await db.execute(delete(GrnLine).where(GrnLine.grn_id == grn.id))
    await _write_grn_lines(db, grn, resolved)
    await db.flush()
    await audit.record(db, user, "grn", grn.id, grn.code, "edit",
                       changes={"before": before, "after": await _grn_snapshot(db, grn)})
    await db.commit()
    return (await _grn_outs(db, [grn]))[0]


@router.delete("/grns/{grn_id}", status_code=204)
async def delete_grn(grn_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(purchasing_access)):
    grn = await db.get(Grn, grn_id)
    if not grn:
        raise HTTPException(404, "GRN not found")
    workflow.ensure_editable(grn, user)
    await audit.record(db, user, "grn", grn.id, grn.code, "delete", from_status=grn.status)
    await db.delete(grn)
    await db.commit()


async def _post_grn(db: AsyncSession, grn: Grn, user: User) -> None:
    po = await db.get(PurchaseOrder, grn.po_id)
    if not po or po.status not in PO_RECEIVABLE:
        raise HTTPException(400, f"Purchase order is {po.status if po else 'missing'} and cannot receive goods")
    lines = (await db.execute(select(GrnLine).where(GrnLine.grn_id == grn.id))).scalars().all()
    if not lines:
        raise HTTPException(400, "Enter a received quantity for at least one item before submitting")
    differing = [l.name for l in lines if abs(float(l.price) - float(l.ordered_price)) > EPS]
    if differing and not (grn.variance_note or "").strip():
        raise HTTPException(
            400, f"Price differs from the order for {', '.join(differing)}: enter the reason in the price variance note before submitting"
        )
    receipt_total = 0.0
    for line in lines:
        po_line = await db.get(PoLine, line.po_line_id) if line.po_line_id else None
        if not po_line:
            raise HTTPException(400, f"{line.name}: the purchase order line no longer exists")
        remaining = float(po_line.qty) - float(po_line.received_qty)
        if float(line.received_qty) > remaining + EPS:
            raise HTTPException(
                400, f"{line.name}: receiving {float(line.received_qty):g} exceeds the {remaining:g} still pending"
            )
        po_line.received_qty = float(po_line.received_qty) + float(line.received_qty)
        receipt_total += float(line.price) * float(line.received_qty)

        item = await db.get(ItemMaster, po_line.item_master_id) if po_line.item_master_id else None
        if not item:
            continue
        # The catalog's "last price" reflects what was actually paid.
        item.last_price = float(line.price)
        if item.stock_type == "general":
            inv = await db.get(Inventory, item.stock_id)
            if inv:
                old_value = float(inv.stock) * float(inv.avg_price)
                new_qty = float(inv.stock) + float(line.received_qty)
                inv.avg_price = (old_value + float(line.received_qty) * float(line.price)) / new_qty if new_qty > 0 else line.price
                inv.last_price = float(line.price)
        await stock.post_in(
            db, stock_type=item.stock_type, stock_id=item.stock_id, cc_id=grn.receiving_cost_center_id,
            qty=float(line.received_qty), unit_cost=float(line.price), txn_type="GRN", txn_id=grn.id,
            txn_code=grn.code, user=user, batch_label=line.batch_label, expiry=line.expiry, received_date=grn.date,
            on=grn.date,
        )

    await db.flush()
    await _refresh_po_status(db, po)

    # The actual receiving cost is auto-logged as an Expense so Dashboard and
    # Reports spend reflect real purchasing activity.
    supplier = await db.get(Supplier, po.supplier_id)
    db.add(
        Expense(
            category="Residence Purchases", amount=round(receipt_total, 2), date=grn.date,
            supplier=supplier.name if supplier else None, method="Bank Transfer",
            notes=f"Auto-logged from {grn.code} — {po.code}", created_by=user.id,
            cost_center_id=grn.receiving_cost_center_id, grn_id=grn.id,
        )
    )


async def _unpost_grn(db: AsyncSession, grn: Grn, user: User) -> None:
    """Stock is already reversed by the workflow; this undoes the PO's
    received quantities and the auto-logged expense."""
    po = await db.get(PurchaseOrder, grn.po_id)
    lines = (await db.execute(select(GrnLine).where(GrnLine.grn_id == grn.id))).scalars().all()
    for line in lines:
        po_line = await db.get(PoLine, line.po_line_id) if line.po_line_id else None
        if po_line:
            po_line.received_qty = max(0.0, float(po_line.received_qty) - float(line.received_qty))
    if po:
        await db.flush()
        await _refresh_po_status(db, po)
    await db.execute(
        delete(Expense).where(or_(Expense.grn_id == grn.id, Expense.notes.like(f"Auto-logged from {grn.code} %")))
    )


workflow.register(
    workflow.DocType("grn", "GRN", Grn, "purchasing", _post_grn, _unpost_grn, creator_attr="received_by")
)


async def _no_stock_effect(db: AsyncSession, obj, user: User) -> None:
    """PRs and POs move no stock; submitting is just the status change."""


async def _unpost_pr(db: AsyncSession, pr: PurchaseRequest, user: User) -> None:
    codes = (await db.execute(select(PurchaseOrder.code).where(PurchaseOrder.source_pr_id == pr.id))).scalars().all()
    if codes:
        raise HTTPException(400, f"{pr.code} has already been ordered ({', '.join(codes)}) and cannot be reopened")


workflow.register(
    workflow.DocType(
        "purchase_request", "Purchase request", PurchaseRequest, "purchasing", _no_stock_effect, _unpost_pr,
        creator_attr="requested_by", reject_status="Rejected",
    )
)
# A PO closes once Fully Received; the Super User may short-close one that
# will never be completed. Orders are not edited after approval, so no reopen.
workflow.register(
    workflow.DocType(
        "purchase_order", "Purchase order", PurchaseOrder, "purchasing", _no_stock_effect,
        creator_attr="created_by", reject_status="Rejected", close_from="Fully Received",
        short_close_from=("Approved", "Partially Received"), can_reopen=False,
    )
)

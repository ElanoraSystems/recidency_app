import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_module
from app.api.v1.kitchen import _recompute_food_rollup
from app.crud.activity import log_activity
from app.db.session import get_db
from app.models.finance import Expense, ResidenceSettings
from app.models.kitchen import FoodInventory, FoodInventoryBatch
from app.models.purchasing import (
    Grn,
    GrnLine,
    Inventory,
    ItemMaster,
    PoLine,
    PurchaseOrder,
    PurchaseRequest,
    PurchaseRequestLine,
    Supplier,
)
from app.models.user import User
from app.services.pdf import logo_data_uri, render_pdf

router = APIRouter(prefix="/purchasing", tags=["purchasing"])
purchasing_access = require_module("purchasing")
# Separate router, same prefix as ItemMaster's generic (read_only) router in
# generic_routes.py — that one serves GET, this one hand-writes POST so
# `code` is always server-generated, never taken from the client.
item_master_router = APIRouter(prefix="/item-master", tags=["purchasing"])


# --------------------------------------------------------- purchase requests
class PurchaseRequestLineIn(BaseModel):
    item_master_id: uuid.UUID | None = None
    item_name: str
    qty: float
    unit: str
    category: str
    est_cost: float = 0


class PurchaseRequestLineOut(PurchaseRequestLineIn):
    id: uuid.UUID

    class Config:
        from_attributes = True


class PurchaseRequestIn(BaseModel):
    urgency: str = "Medium"
    note: str | None = None
    lines: list[PurchaseRequestLineIn]


class PurchaseRequestOut(BaseModel):
    id: uuid.UUID
    request_date: date
    status: str
    urgency: str
    requested_by: uuid.UUID | None
    note: str | None
    lines: list[PurchaseRequestLineOut]
    total_est_cost: float

    class Config:
        from_attributes = True


async def _pr_out(db: AsyncSession, pr: PurchaseRequest) -> PurchaseRequestOut:
    result = await db.execute(select(PurchaseRequestLine).where(PurchaseRequestLine.pr_id == pr.id))
    lines = [
        PurchaseRequestLineOut(
            id=l.id, item_master_id=l.item_master_id, item_name=l.item_name,
            qty=float(l.qty), unit=l.unit, category=l.category, est_cost=float(l.est_cost),
        )
        for l in result.scalars().all()
    ]
    return PurchaseRequestOut(
        id=pr.id, request_date=pr.request_date, status=pr.status, urgency=pr.urgency,
        requested_by=pr.requested_by, note=pr.note, lines=lines,
        total_est_cost=round(sum(l.est_cost for l in lines), 2),
    )


@router.get("/purchase-requests", response_model=list[PurchaseRequestOut])
async def list_purchase_requests(
    db: AsyncSession = Depends(get_db), _user: User = Depends(purchasing_access)
):
    result = await db.execute(select(PurchaseRequest).order_by(PurchaseRequest.request_date.desc()))
    return [await _pr_out(db, pr) for pr in result.scalars().all()]


@router.post("/purchase-requests", response_model=PurchaseRequestOut, status_code=201)
async def create_purchase_request(
    payload: PurchaseRequestIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(purchasing_access),
):
    if not payload.lines:
        raise HTTPException(400, "A purchase request needs at least one line item")
    pr = PurchaseRequest(
        request_date=date.today(), status="Pending Approval",
        urgency=payload.urgency, note=payload.note, requested_by=user.id,
    )
    db.add(pr)
    await db.flush()
    for line in payload.lines:
        db.add(PurchaseRequestLine(pr_id=pr.id, **line.model_dump()))
    await log_activity(db, user, "Submitted purchase request", f"{len(payload.lines)} item(s)")
    await db.commit()
    await db.refresh(pr)
    return await _pr_out(db, pr)


@router.post("/purchase-requests/{pr_id}/decision", response_model=PurchaseRequestOut)
async def decide_purchase_request(
    pr_id: uuid.UUID,
    approve: bool,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(purchasing_access),
):
    pr = await db.get(PurchaseRequest, pr_id)
    if not pr:
        raise HTTPException(404, "Purchase request not found")
    pr.status = "Approved" if approve else "Rejected"
    line_count = len((await db.execute(select(PurchaseRequestLine).where(PurchaseRequestLine.pr_id == pr_id))).scalars().all())
    await log_activity(db, user, f"{pr.status} purchase request", f"{line_count} item(s)")
    await db.commit()
    await db.refresh(pr)
    return await _pr_out(db, pr)


# ----------------------------------------------------------- purchase orders
class PoLineIn(BaseModel):
    item_master_id: uuid.UUID | None = None
    name: str
    qty: float
    unit: str
    price: float
    last_price: float | None = None


class PurchaseOrderIn(BaseModel):
    supplier_id: uuid.UUID
    expected_date: date | None = None
    source_pr_id: uuid.UUID | None = None
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
    lines: list[PoLineOut]

    class Config:
        from_attributes = True


async def _po_out(db: AsyncSession, po: PurchaseOrder) -> PurchaseOrderOut:
    result = await db.execute(select(PoLine).where(PoLine.po_id == po.id))
    lines = result.scalars().all()
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
        lines=[
            PoLineOut(
                id=line.id,
                item_master_id=line.item_master_id,
                name=line.name,
                qty=float(line.qty),
                unit=line.unit,
                price=float(line.price),
                last_price=float(line.last_price) if line.last_price is not None else None,
                received_qty=float(line.received_qty),
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
                {"name": l.name, "qty": float(l.qty), "unit": l.unit, "price": float(l.price),
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


async def _next_code(db: AsyncSession, model, prefix: str, start: int) -> str:
    result = await db.execute(select(model.code).order_by(model.code.desc()).limit(1))
    last = result.scalar_one_or_none()
    n = int(last.split("-")[1]) + 1 if last else start
    return f"{prefix}-{n}"


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

    class Config:
        from_attributes = True


async def _stock_lookup(db: AsyncSession, stock_type: str, stock_id: uuid.UUID) -> tuple[str, float]:
    if stock_type == "food":
        stock = await db.get(FoodInventory, stock_id)
        return (stock.category, float(stock.cost)) if stock else ("—", 0.0)
    stock = await db.get(Inventory, stock_id)
    return (stock.category, float(stock.avg_price)) if stock else ("—", 0.0)


def _item_master_out(item: ItemMaster, category: str, avg_price: float) -> ItemMasterOut:
    return ItemMasterOut(
        id=item.id, code=item.code, name=item.name, uom=item.uom, last_price=item.last_price,
        preferred_supplier_id=item.preferred_supplier_id, active=item.active,
        stock_type=item.stock_type, stock_id=item.stock_id, category=category, avg_price=avg_price,
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

    out = []
    for item in items:
        stock = (food_rows if item.stock_type == "food" else general_rows).get(item.stock_id)
        if stock is None:
            out.append(_item_master_out(item, "—", 0.0))
        else:
            avg_price = float(stock.cost if item.stock_type == "food" else stock.avg_price)
            out.append(_item_master_out(item, stock.category, avg_price))
    return out


@item_master_router.get("/{item_id}", response_model=ItemMasterOut)
async def get_item_master(
    item_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(purchasing_access)
):
    item = await db.get(ItemMaster, item_id)
    if not item:
        raise HTTPException(404, "Item master entry not found")
    category, avg_price = await _stock_lookup(db, item.stock_type, item.stock_id)
    return _item_master_out(item, category, avg_price)


@item_master_router.post("", response_model=ItemMasterOut, status_code=201)
async def create_item_master(
    payload: ItemMasterIn, db: AsyncSession = Depends(get_db), user: User = Depends(purchasing_access)
):
    """Hand-written (not generic CRUD) purely so `code` is always
    server-generated — see ItemMaster having no generic router registration
    at all (generic_routes.py) for why every item-master route lives here."""
    item = ItemMaster(
        code=await _next_item_code(db),
        **payload.model_dump(),
    )
    db.add(item)
    await log_activity(db, user, "Added item master entry", f"{payload.name} ({item.code})")
    await db.commit()
    await db.refresh(item)
    category, avg_price = await _stock_lookup(db, item.stock_type, item.stock_id)
    return _item_master_out(item, category, avg_price)


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
        status="Pending Approval",
        order_date=date.today(),
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
    await db.commit()
    await db.refresh(po)
    return await _po_out(db, po)


async def _transition_po_to_ordered(db: AsyncSession, po: PurchaseOrder, user: User, approve: bool) -> None:
    """The single place a PO's approval decision is applied — called from
    both this module's own decision endpoint AND approvals.py's unified
    inbox (previously two separate code paths that could each flip status
    to "Ordered" without the other knowing, so approved_by/PDF generation
    only had to be wired into one path)."""
    po.status = "Ordered" if approve else "Rejected"
    if approve:
        po.approved_by = user.id
    await log_activity(db, user, f"{'Approved' if approve else 'Rejected'} purchase order", po.code)


@router.post("/purchase-orders/{po_id}/decision", response_model=PurchaseOrderOut)
async def decide_purchase_order(
    po_id: uuid.UUID,
    approve: bool,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(purchasing_access),
):
    po = await db.get(PurchaseOrder, po_id)
    if not po:
        raise HTTPException(404, "Purchase order not found")
    await _transition_po_to_ordered(db, po, user, approve)
    await db.commit()
    await db.refresh(po)
    return await _po_out(db, po)


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
    if pr.status != "Approved":
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
            status="Pending Approval" if total > 500 else "Ordered",
            order_date=date.today(),
            expected_date=group.expected_date,
            total=total,
            payment_status="Unpaid",
            source_pr_id=pr.id,
            created_by=user.id,
        )
        db.add(po)
        await db.flush()
        for g in group.lines:
            line = pr_lines[g.pr_line_id]
            db.add(PoLine(
                po_id=po.id, item_master_id=line.item_master_id, name=line.item_name,
                qty=float(line.qty), unit=line.unit, price=g.price, last_price=g.price,
            ))
        created_pos.append(po)
        po_codes.append(po.code)

    pr.status = f"Ordered → {', '.join(po_codes)}"
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
    lines: list[GrnLineIn]


class GrnLineOut(BaseModel):
    id: uuid.UUID
    name: str
    ordered_qty: float
    received_qty: float
    unit: str
    ordered_price: float
    price: float

    class Config:
        from_attributes = True


class GrnOut(BaseModel):
    id: uuid.UUID
    code: str
    po_id: uuid.UUID
    supplier_id: uuid.UUID
    date: date
    received_by_name: str | None = None
    lines: list[GrnLineOut]

    class Config:
        from_attributes = True


async def _grn_out(db: AsyncSession, grn: Grn) -> GrnOut:
    lines_result = await db.execute(select(GrnLine).where(GrnLine.grn_id == grn.id))
    receiver = await db.get(User, grn.received_by) if grn.received_by else None
    return GrnOut(
        id=grn.id,
        code=grn.code,
        po_id=grn.po_id,
        supplier_id=grn.supplier_id,
        date=grn.date,
        received_by_name=receiver.name if receiver else None,
        lines=lines_result.scalars().all(),
    )


@router.get("/grns", response_model=list[GrnOut])
async def list_grns(db: AsyncSession = Depends(get_db), _user: User = Depends(purchasing_access)):
    result = await db.execute(select(Grn).order_by(Grn.date.desc()))
    return [await _grn_out(db, grn) for grn in result.scalars().all()]


@router.post("/grns", response_model=GrnOut, status_code=201)
async def receive_goods(
    payload: GrnIn, db: AsyncSession = Depends(get_db), user: User = Depends(purchasing_access)
):
    """Receiving a GRN updates stock and the PO's received quantities in one
    transaction — the highest-risk interlock in the app (build plan §07,
    phase 2 'done' criteria: 'receiving a GRN updates stock')."""
    po = await db.get(PurchaseOrder, payload.po_id)
    if not po:
        raise HTTPException(404, "Purchase order not found")

    grn = Grn(
        code=await _next_code(db, Grn, "GRN", 2001),
        po_id=po.id,
        supplier_id=po.supplier_id,
        date=date.today(),
        received_by=user.id,
    )
    db.add(grn)
    await db.flush()

    receipt_total = 0.0
    for line_in in payload.lines:
        po_line = await db.get(PoLine, line_in.po_line_id)
        if not po_line or po_line.po_id != po.id:
            raise HTTPException(400, f"PO line {line_in.po_line_id} does not belong to this PO")

        ordered_price = float(po_line.price)
        actual_price = line_in.actual_price if line_in.actual_price is not None else ordered_price
        receipt_total += actual_price * line_in.received_qty

        db.add(
            GrnLine(
                grn_id=grn.id,
                po_line_id=po_line.id,
                name=po_line.name,
                ordered_qty=po_line.qty,
                received_qty=line_in.received_qty,
                unit=po_line.unit,
                ordered_price=ordered_price,
                price=actual_price,
            )
        )
        po_line.received_qty = float(po_line.received_qty) + line_in.received_qty

        if po_line.item_master_id:
            item = await db.get(ItemMaster, po_line.item_master_id)
            if item:
                # The catalog's "last price" reflects what was actually
                # paid, not what was originally ordered.
                item.last_price = actual_price
                if item.stock_type == "food":
                    stock = await db.get(FoodInventory, item.stock_id)
                    if stock:
                        # Each receipt is its own batch lot (own cost,
                        # own expiry) rather than blended into one figure —
                        # lets consumption draw FEFO instead of averaging
                        # away which stock is actually closest to expiry.
                        db.add(
                            FoodInventoryBatch(
                                food_inventory_id=stock.id,
                                batch_label=line_in.batch_label,
                                qty=line_in.received_qty,
                                expiry=line_in.expiry,
                                cost=actual_price,
                                received_date=date.today(),
                            )
                        )
                        await db.flush()
                        await _recompute_food_rollup(db, stock.id)
                else:
                    stock = await db.get(Inventory, item.stock_id)
                    if stock:
                        old_value = float(stock.stock) * float(stock.avg_price)
                        new_value = line_in.received_qty * actual_price
                        new_qty = float(stock.stock) + line_in.received_qty
                        stock.avg_price = (old_value + new_value) / new_qty if new_qty > 0 else actual_price
                        stock.last_price = actual_price
                        stock.stock = new_qty

    result = await db.execute(select(PoLine).where(PoLine.po_id == po.id))
    all_lines = result.scalars().all()
    fully_received = all(float(l.received_qty) >= float(l.qty) for l in all_lines)
    po.status = "Goods Received" if fully_received else "Partially Received"

    # Auto-log the actual receiving cost as an Expense so Dashboard/Reports
    # spend figures reflect real purchasing activity — Purchasing and
    # Expenses used to be two disconnected islands (a GRN created no
    # financial record anywhere). Manual Expense entry stays available
    # separately for non-stock costs (utilities, salaries, cash buys).
    supplier = await db.get(Supplier, po.supplier_id)
    db.add(
        Expense(
            category="Residence Purchases",
            amount=round(receipt_total, 2),
            date=date.today(),
            supplier=supplier.name if supplier else None,
            method="Bank Transfer",
            notes=f"Auto-logged from {grn.code} — {po.code}",
            created_by=user.id,
        )
    )

    await log_activity(db, user, "Received goods", f"{grn.code} — {po.code}")
    await db.commit()
    await db.refresh(grn)

    return await _grn_out(db, grn)

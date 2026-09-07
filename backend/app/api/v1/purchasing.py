import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_module
from app.crud.activity import log_activity
from app.db.session import get_db
from app.models.finance import Expense, ResidenceSettings
from app.models.kitchen import FoodInventory
from app.models.purchasing import (
    Grn,
    GrnLine,
    Inventory,
    ItemMaster,
    PoLine,
    PurchaseOrder,
    PurchaseRequest,
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
class PurchaseRequestIn(BaseModel):
    item: str
    qty: float
    unit: str
    category: str
    urgency: str = "Medium"
    est_cost: float = 0
    linked_inventory_id: uuid.UUID | None = None
    note: str | None = None


class PurchaseRequestOut(PurchaseRequestIn):
    id: uuid.UUID
    request_date: date
    status: str
    requested_by: uuid.UUID | None

    class Config:
        from_attributes = True


@router.get("/purchase-requests", response_model=list[PurchaseRequestOut])
async def list_purchase_requests(
    db: AsyncSession = Depends(get_db), _user: User = Depends(purchasing_access)
):
    result = await db.execute(select(PurchaseRequest).order_by(PurchaseRequest.request_date.desc()))
    return result.scalars().all()


@router.post("/purchase-requests", response_model=PurchaseRequestOut, status_code=201)
async def create_purchase_request(
    payload: PurchaseRequestIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(purchasing_access),
):
    pr = PurchaseRequest(
        **payload.model_dump(),
        request_date=date.today(),
        status="Pending Approval",
        requested_by=user.id,
    )
    db.add(pr)
    await log_activity(db, user, "Submitted purchase request", f"{payload.item} × {payload.qty}")
    await db.commit()
    await db.refresh(pr)
    return pr


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
    await log_activity(db, user, f"{pr.status} purchase request", f"{pr.item} × {pr.qty}")
    await db.commit()
    await db.refresh(pr)
    return pr


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
    min_stock: float = 0
    reorder_level: float = 0
    active: bool = True
    stock_type: str  # food | general
    stock_id: uuid.UUID


class ItemMasterOut(ItemMasterIn):
    id: uuid.UUID
    code: str

    class Config:
        from_attributes = True


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


@item_master_router.post("", response_model=ItemMasterOut, status_code=201)
async def create_item_master(
    payload: ItemMasterIn, db: AsyncSession = Depends(get_db), user: User = Depends(purchasing_access)
):
    """Hand-written (not generic CRUD) purely so `code` is always
    server-generated — see ItemMaster's generic router registration in
    generic_routes.py (read_only=True, GET only) for why this lives here."""
    item = ItemMaster(
        code=await _next_item_code(db),
        **payload.model_dump(),
    )
    db.add(item)
    await log_activity(db, user, "Added item master entry", f"{payload.name} ({item.code})")
    await db.commit()
    await db.refresh(item)
    return item


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


class ConvertPrToPoIn(BaseModel):
    supplier_id: uuid.UUID
    price: float
    expected_date: date | None = None


@router.post("/purchase-requests/{pr_id}/convert-to-po", response_model=PurchaseOrderOut)
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

    pr_qty = float(pr.qty)
    total = pr_qty * payload.price
    po = PurchaseOrder(
        code=await _next_code(db, PurchaseOrder, "PO", 1001),
        supplier_id=payload.supplier_id,
        status="Pending Approval" if total > 500 else "Ordered",
        order_date=date.today(),
        expected_date=payload.expected_date,
        total=total,
        payment_status="Unpaid",
        source_pr_id=pr.id,
        created_by=user.id,
    )
    db.add(po)
    await db.flush()
    db.add(PoLine(
        po_id=po.id, item_master_id=pr.linked_inventory_id, name=pr.item,
        qty=pr_qty, unit=pr.unit, price=payload.price, last_price=payload.price,
    ))
    pr.status = f"Ordered → {po.code}"
    await log_activity(db, user, "Created purchase order", f"{po.code} from {pr.item} — total {total:.2f}")
    await db.commit()
    await db.refresh(po)
    return await _po_out(db, po)


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
                        # True moving-average cost: blend the value of what
                        # was already on the shelf with the value of this
                        # receipt, so cost reflects stock bought at
                        # different prices over time rather than just the
                        # most recent one.
                        old_value = float(stock.qty) * float(stock.cost)
                        new_value = line_in.received_qty * actual_price
                        new_qty = float(stock.qty) + line_in.received_qty
                        stock.cost = (old_value + new_value) / new_qty if new_qty > 0 else actual_price
                        stock.qty = new_qty
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

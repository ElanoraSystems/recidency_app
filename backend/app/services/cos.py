"""Cost of sales per cost center, derived from the stock ledger when a
monthly stock count is submitted.

  COS = opening + purchases + transfers in - transfers out - closing

Opening and closing are the cost-valued net balance of the location from the
ledger (closing includes the count's own adjustments, so it equals the
counted stock). Reversal rows are attributed to the document they undo, so a
reversed receipt or meal nets out in the right month."""

import uuid
from datetime import date, datetime, time, timezone

from sqlalchemy import and_, case, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.stock import CostOfSales, StockMovement


async def record_cost_of_sales(db: AsyncSession, cc_id: uuid.UUID, count_id: uuid.UUID, count_date: date) -> None:
    start = datetime(count_date.year, count_date.month, 1, tzinfo=timezone.utc)
    end = datetime.combine(count_date, time.max, tzinfo=timezone.utc)

    orig = aliased(StockMovement)
    m = StockMovement
    eff = func.coalesce(orig.txn_type, m.txn_type)
    inflow = case((m.to_cost_center_id == cc_id, m.total_value), else_=0)
    outflow = case((m.from_cost_center_id == cc_id, m.total_value), else_=0)
    here = or_(m.to_cost_center_id == cc_id, m.from_cost_center_id == cc_id)
    own = m.txn_id == count_id

    def totals(*conditions):
        return (
            select(m.stock_type, eff.label("eff"), func.coalesce(func.sum(inflow), 0), func.coalesce(func.sum(outflow), 0))
            .select_from(m).outerjoin(orig, orig.id == m.reverses_id)
            .where(here, *conditions).group_by(m.stock_type, eff)
        )

    opening_rows = (await db.execute(totals(or_(m.created_at < start, eff == "OPENING")))).all()
    closing_rows = (await db.execute(totals(or_(m.created_at <= end, own, eff == "OPENING")))).all()
    flow_rows = (
        await db.execute(totals(eff != "OPENING", or_(and_(m.created_at >= start, m.created_at <= end), own)))
    ).all()

    def net(rows, stock_type):
        return sum(float(i) - float(o) for st, _e, i, o in rows if st == stock_type)

    period = count_date.strftime("%Y-%m")
    await db.execute(delete(CostOfSales).where(CostOfSales.cost_center_id == cc_id, CostOfSales.period == period))
    for stock_type in ("food", "general"):
        flow = {e: (float(i), float(o)) for st, e, i, o in flow_rows if st == stock_type}
        opening, closing = net(opening_rows, stock_type), net(closing_rows, stock_type)
        if not (opening or closing or flow):
            continue
        grn_in, grn_out = flow.get("GRN", (0.0, 0.0))
        tr_in, tr_out = flow.get("TRANSFER", (0.0, 0.0))
        purchases = grn_in - grn_out
        db.add(
            CostOfSales(
                cost_center_id=cc_id, period=period, stock_type=stock_type, stock_count_id=count_id,
                count_date=datetime.combine(count_date, time.min, tzinfo=timezone.utc),
                opening_value=round(opening, 3), purchases=round(purchases, 3),
                transfers_in=round(tr_in, 3), transfers_out=round(tr_out, 3), closing_value=round(closing, 3),
                cost_of_sales=round(opening + purchases + tr_in - tr_out - closing, 3),
                meals_value=round(flow.get("MEAL_LOG", (0.0, 0.0))[1] - flow.get("MEAL_LOG", (0.0, 0.0))[0], 3),
                waste_value=round(flow.get("WASTE", (0.0, 0.0))[1] - flow.get("WASTE", (0.0, 0.0))[0], 3),
                count_variance=round(flow.get("COUNT", (0.0, 0.0))[1] - flow.get("COUNT", (0.0, 0.0))[0], 3),
            )
        )

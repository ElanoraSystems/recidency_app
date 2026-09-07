from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.facilities import Area, MaintenanceRequest
from app.models.family_guests import Event, Guest
from app.models.finance import Expense
from app.models.people import StaffProfile
from app.models.purchasing import Inventory, PurchaseRequest
from app.models.tasks import Task
from app.models.user import User

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary")
async def dashboard_summary(db: AsyncSession = Depends(get_db), _user: User = Depends(get_current_user)):
    today = date.today()

    staff_onsite = (
        await db.execute(
            select(func.count()).select_from(StaffProfile).where(
                StaffProfile.off_site_role.is_(False), StaffProfile.status == "Active"
            )
        )
    ).scalar_one()

    todays_tasks = (
        await db.execute(select(func.count()).select_from(Task).where(Task.due_date == today))
    ).scalar_one()

    avg_completion = (await db.execute(select(func.avg(Area.completion)))).scalar_one()

    maint_pending = (
        await db.execute(
            select(func.count()).select_from(MaintenanceRequest).where(
                MaintenanceRequest.status.notin_(["Closed", "Verified"])
            )
        )
    ).scalar_one()

    low_stock = (
        await db.execute(select(func.count()).select_from(Inventory).where(Inventory.stock < Inventory.min))
    ).scalar_one()

    purch_pending = (
        await db.execute(
            select(func.count()).select_from(PurchaseRequest).where(
                PurchaseRequest.status == "Pending Approval"
            )
        )
    ).scalar_one()

    today_spend = (
        await db.execute(select(func.coalesce(func.sum(Expense.amount), 0)).where(Expense.date == today))
    ).scalar_one()

    month_start = today.replace(day=1)
    month_spend = (
        await db.execute(
            select(func.coalesce(func.sum(Expense.amount), 0)).where(Expense.date >= month_start)
        )
    ).scalar_one()

    upcoming_guests = (
        await db.execute(
            select(func.count()).select_from(Guest).where(
                Guest.arrival >= today, Guest.arrival <= today + timedelta(days=7)
            )
        )
    ).scalar_one()

    upcoming_events = (
        await db.execute(
            select(func.count()).select_from(Event).where(
                Event.date >= today, Event.date <= today + timedelta(days=14)
            )
        )
    ).scalar_one()

    return {
        "staff_onsite": staff_onsite,
        "todays_tasks": todays_tasks,
        "housekeeping_avg_completion": round(float(avg_completion or 0)),
        "maintenance_pending": maint_pending,
        "low_stock_items": low_stock,
        "purchasing_pending": purch_pending,
        "today_spend": float(today_spend),
        "month_spend": float(month_spend),
        "upcoming_guests": upcoming_guests,
        "upcoming_events": upcoming_events,
    }

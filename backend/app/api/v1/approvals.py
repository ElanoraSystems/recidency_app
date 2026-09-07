import uuid
from calendar import monthrange
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.purchasing import _transition_po_to_ordered
from app.api.v1.tasks import _check_overlap, _recompute_area_completion
from app.crud.activity import log_activity
from app.db.session import get_db
from app.models.facilities import Asset, MaintenanceRequest
from app.models.kitchen import ProposedMenu, WasteLog, WasteLogLine, WeeklyMealPlan
from app.models.people import LeaveRequest, StaffProfile
from app.models.purchasing import PurchaseOrder, PurchaseRequest
from app.models.tasks import Task, TaskChecklistItem, TaskComment
from app.models.user import User

router = APIRouter(prefix="/approvals", tags=["approvals"])


def _advance_due_date(due_date: date, recurrence: str, interval_days: int | None) -> date | None:
    """Where a recurring task's next occurrence lands, or None if this
    recurrence can't be advanced (One-time, or Custom with no interval set)."""
    if recurrence == "Daily":
        return due_date + timedelta(days=1)
    if recurrence == "Weekly":
        return due_date + timedelta(days=7)
    if recurrence == "Monthly":
        month = due_date.month + 1
        year = due_date.year + (1 if month > 12 else 0)
        month = 1 if month > 12 else month
        day = min(due_date.day, monthrange(year, month)[1])
        return due_date.replace(year=year, month=month, day=day)
    if recurrence == "Custom" and interval_days:
        return due_date + timedelta(days=interval_days)
    return None


async def _spawn_next_occurrence(db: AsyncSession, task: Task, user: User) -> None:
    next_due = _advance_due_date(task.due_date, task.recurrence, task.recurrence_interval_days)
    if not next_due:
        return
    if task.assignee_id and task.start_time and task.end_time:
        conflict = await _check_overlap(db, task.assignee_id, next_due, task.start_time, task.end_time)
        if conflict:
            await log_activity(
                db, user, "Skipped next recurring occurrence — schedule conflict",
                f"{task.title} — would repeat on {next_due}",
            )
            return
    next_task = Task(
        title=task.title, category=task.category, description=task.description,
        assignee_id=task.assignee_id, location_id=task.location_id, priority=task.priority,
        due_date=next_due, due_time=task.due_time, start_time=task.start_time, end_time=task.end_time,
        recurrence=task.recurrence, recurrence_interval_days=task.recurrence_interval_days,
        status="Pending",
    )
    db.add(next_task)
    await db.flush()
    checklist = (
        await db.execute(select(TaskChecklistItem).where(TaskChecklistItem.task_id == task.id))
    ).scalars().all()
    for item in checklist:
        db.add(TaskChecklistItem(task_id=next_task.id, text=item.text, done=False))
    if next_task.category == "Housekeeping":
        await _recompute_area_completion(db, next_task.location_id)
    await log_activity(db, user, "Created next recurring occurrence", f"{task.title} — due {next_due}")


@router.get("")
async def list_approvals(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Unified inbox: a query across PRs, POs, menu proposals, assets and
    leave — a view, not a stored table (build plan §03, §04)."""
    out = []

    prs = (
        await db.execute(select(PurchaseRequest).where(PurchaseRequest.status == "Pending Approval"))
    ).scalars().all()
    for pr in prs:
        out.append(
            {
                "type": "purchase_request", "id": pr.id, "title": f"Purchase request — {pr.item}",
                "sub": f"{pr.qty} {pr.unit} · est. {pr.est_cost}", "date": pr.request_date.isoformat(),
            }
        )

    pos = (
        await db.execute(select(PurchaseOrder).where(PurchaseOrder.status == "Pending Approval"))
    ).scalars().all()
    for po in pos:
        out.append(
            {
                "type": "purchase_order", "id": po.id, "title": f"Purchase order — {po.code}",
                "sub": f"Total {po.total}", "date": po.order_date.isoformat(),
            }
        )

    menus = (
        await db.execute(select(ProposedMenu).where(ProposedMenu.status == "Proposed"))
    ).scalars().all()
    for menu in menus:
        out.append(
            {
                "type": "proposed_menu", "id": menu.id, "title": f"Menu proposal — {menu.occasion}",
                "sub": menu.category, "date": menu.for_date.isoformat(),
            }
        )

    assets = (await db.execute(select(Asset).where(Asset.approval_status == "Pending"))).scalars().all()
    for asset in assets:
        out.append(
            {
                "type": "asset", "id": asset.id, "title": f"New asset — {asset.name}",
                "sub": asset.category, "date": None,
            }
        )

    leaves = (
        await db.execute(select(LeaveRequest).where(LeaveRequest.status == "Pending"))
    ).scalars().all()
    for lv in leaves:
        staff = await db.get(StaffProfile, lv.staff_id)
        out.append(
            {
                "type": "leave_request", "id": lv.id, "title": f"Leave request — {lv.type}",
                "sub": f"{lv.days} day(s)" + (f" · {staff.position}" if staff else ""),
                "date": lv.requested_on.isoformat(),
            }
        )

    completed_tasks = (await db.execute(select(Task).where(Task.status == "Completed"))).scalars().all()
    for task in completed_tasks:
        # Only surface a task review to the person who can actually act on it
        # (the assignee's supervisor, or the Owner) — otherwise every
        # completed task gets broadcast to every logged-in user's bell.
        if not await _can_review_task(db, user, task):
            continue
        assignee_name = "Unassigned"
        if task.assignee_id:
            assignee = await db.get(StaffProfile, task.assignee_id)
            assignee_user = await db.get(User, assignee.user_id) if assignee else None
            assignee_name = assignee_user.name if assignee_user else "Unassigned"
        out.append(
            {
                "type": "task_review", "id": task.id, "title": f"Task review — {task.title}",
                "sub": f"{assignee_name} · {task.category}", "date": task.due_date.isoformat(),
            }
        )

    repaired = (
        await db.execute(select(MaintenanceRequest).where(MaintenanceRequest.status == "Repaired"))
    ).scalars().all()
    for req in repaired:
        assignee_name = "Unassigned"
        if req.assignee_id:
            assignee = await db.get(StaffProfile, req.assignee_id)
            assignee_user = await db.get(User, assignee.user_id) if assignee else None
            assignee_name = assignee_user.name if assignee_user else "Unassigned"
        out.append(
            {
                "type": "maintenance_confirmation", "id": req.id,
                "title": f"Maintenance confirmation — {req.issue}",
                "sub": f"Repaired by {assignee_name} · {req.priority}",
                "date": req.reported_date.isoformat(),
            }
        )

    weekly_plans = (
        await db.execute(select(WeeklyMealPlan).where(WeeklyMealPlan.status == "Pending Approval"))
    ).scalars().all()
    for plan in weekly_plans:
        out.append(
            {
                "type": "weekly_meal_plan", "id": plan.id,
                "title": f"Weekly meal plan — {plan.occasion_type}",
                "sub": f"Week of {plan.week_start_date.isoformat()}",
                "date": plan.week_start_date.isoformat(),
            }
        )

    waste_logs = (
        await db.execute(select(WasteLog).where(WasteLog.status == "Pending Review"))
    ).scalars().all()
    for waste in waste_logs:
        # Same per-user visibility rule as task_review — only the logger's
        # supervisor (or the Owner) should be pinged, not every user.
        if not await _can_review_waste(db, user, waste):
            continue
        line_count = (
            await db.execute(select(WasteLogLine).where(WasteLogLine.waste_log_id == waste.id))
        ).scalars().all()
        out.append(
            {
                "type": "waste_log", "id": waste.id, "title": f"Waste log — {waste.reason}",
                "sub": f"{len(line_count)} item(s) logged", "date": waste.date.isoformat(),
            }
        )

    return out


DECISION_MODELS = {
    "purchase_request": (PurchaseRequest, {"approve": "Approved", "reject": "Rejected"}),
    # purchase_order is deliberately NOT here — see the custom branch in
    # decide() below, which calls purchasing.py's _transition_po_to_ordered
    # so this path and purchasing.py's own decision endpoint can't drift
    # apart (they used to both flip status independently).
    "proposed_menu": (ProposedMenu, {"approve": "Approved", "reject": "Rejected"}),
    "asset": (Asset, {"approve": "Approved", "reject": "Rejected"}),
    "leave_request": (LeaveRequest, {"approve": "Approved", "reject": "Rejected"}),
    # Rejecting bounces a weekly meal plan straight back to Draft so it can
    # be edited and resubmitted, rather than a dead-end "Rejected" status.
    "weekly_meal_plan": (WeeklyMealPlan, {"approve": "Approved", "reject": "Draft"}),
}

STATUS_FIELD = {
    "purchase_request": "status",
    "proposed_menu": "status",
    "asset": "approval_status",
    "leave_request": "status",
    "weekly_meal_plan": "status",
}


async def _can_review_task(db: AsyncSession, user: User, task: Task) -> bool:
    """Whether `user` is the assignee's defined supervisor, or the Owner
    (the fallback reviewer when no supervisor is set)."""
    if user.user_type == "owner":
        return True
    assignee = await db.get(StaffProfile, task.assignee_id) if task.assignee_id else None
    reviewer_profile = (
        await db.execute(select(StaffProfile).where(StaffProfile.user_id == user.id))
    ).scalar_one_or_none()
    return bool(assignee and reviewer_profile and assignee.supervisor_id == reviewer_profile.id)


async def _authorize_task_review(db: AsyncSession, user: User, task: Task) -> None:
    if not await _can_review_task(db, user, task):
        raise HTTPException(403, "Only this staff member's supervisor (or the Owner) can review this task")


async def _can_review_waste(db: AsyncSession, user: User, waste: WasteLog) -> bool:
    """Whether `user` is the logger's defined supervisor, or the Owner —
    same shape as _can_review_task, just keyed off who logged the waste
    entry rather than who was assigned the task."""
    if user.user_type == "owner":
        return True
    if not waste.logged_by:
        return False
    logger_profile = (
        await db.execute(select(StaffProfile).where(StaffProfile.user_id == waste.logged_by))
    ).scalar_one_or_none()
    reviewer_profile = (
        await db.execute(select(StaffProfile).where(StaffProfile.user_id == user.id))
    ).scalar_one_or_none()
    return bool(logger_profile and reviewer_profile and logger_profile.supervisor_id == reviewer_profile.id)


async def _authorize_waste_review(db: AsyncSession, user: User, waste: WasteLog) -> None:
    if not await _can_review_waste(db, user, waste):
        raise HTTPException(403, "Only this staff member's supervisor (or the Owner) can review this waste log")


def _authorize_maintenance_confirmation(user: User, req: MaintenanceRequest) -> None:
    """Only the Owner, or the user who originally filed the request, may
    confirm repaired work. Owner is also the fallback when reported_by
    wasn't captured (legacy requests filed before this field existed)."""
    if user.user_type == "owner":
        return
    if req.reported_by != user.id:
        raise HTTPException(403, "Only the person who reported this issue (or the Owner) can confirm it")


@router.post("/{item_type}/{item_id}/decision")
async def decide(
    item_type: str,
    item_id: uuid.UUID,
    approve: bool,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if item_type == "maintenance_confirmation":
        req = await db.get(MaintenanceRequest, item_id)
        if not req:
            raise HTTPException(404, "Maintenance request not found")
        if req.status != "Repaired":
            raise HTTPException(400, "This request is not awaiting confirmation")
        _authorize_maintenance_confirmation(user, req)
        if approve:
            req.status = "Verified"
            req.verified = True
            action = "Confirmed maintenance work"
        else:
            req.status = "In Progress"
            req.verified = False
            action = "Rejected maintenance work — sent back"
        await log_activity(db, user, action, req.issue)
        await db.commit()
        return {"ok": True, "status": req.status}

    if item_type == "task_review":
        task = await db.get(Task, item_id)
        if not task:
            raise HTTPException(404, "Task not found")
        if task.status != "Completed":
            raise HTTPException(400, "This task is not awaiting review")
        await _authorize_task_review(db, user, task)
        if approve:
            task.status = "Verified"
            task.verified = True
            comment_text = f"Approved by {user.name}"
        else:
            task.status = "In Progress"
            task.verified = False
            comment_text = f"Sent back for rework by {user.name}"
        db.add(TaskComment(task_id=task.id, author_name=user.name, text=comment_text, at=date.today()))
        await log_activity(db, user, "Verified task" if approve else "Rejected task", task.title)
        if task.category == "Housekeeping":
            await _recompute_area_completion(db, task.location_id)
        if approve and task.recurrence != "One-time":
            await _spawn_next_occurrence(db, task, user)
        await db.commit()
        return {"ok": True, "status": task.status}

    if item_type == "purchase_order":
        po = await db.get(PurchaseOrder, item_id)
        if not po:
            raise HTTPException(404, "Purchase order not found")
        await _transition_po_to_ordered(db, po, user, approve)
        await db.commit()
        return {"ok": True, "status": po.status}

    if item_type == "waste_log":
        waste = await db.get(WasteLog, item_id)
        if not waste:
            raise HTTPException(404, "Waste log not found")
        if waste.status != "Pending Review":
            raise HTTPException(400, "This waste log is not awaiting review")
        await _authorize_waste_review(db, user, waste)
        # No inventory reversal on reject — the stock is already gone
        # regardless of whether the paperwork was accurate; rejecting just
        # flags the record for follow-up.
        waste.status = "Reviewed" if approve else "Flagged"
        waste.reviewed_by = user.id
        await log_activity(db, user, "Reviewed waste log" if approve else "Flagged waste log", waste.reason)
        await db.commit()
        return {"ok": True, "status": waste.status}

    if item_type not in DECISION_MODELS:
        raise HTTPException(404, "Unknown approval type")
    model, statuses = DECISION_MODELS[item_type]
    obj = await db.get(model, item_id)
    if not obj:
        raise HTTPException(404, "Item not found")
    new_status = statuses["approve"] if approve else statuses["reject"]
    setattr(obj, STATUS_FIELD[item_type], new_status)
    await log_activity(db, user, f"{new_status} {item_type.replace('_', ' ')}", str(item_id))
    await db.commit()
    return {"ok": True, "status": new_status}

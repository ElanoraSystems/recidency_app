import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.purchasing import decide_po
from app.api.v1.tasks import _recompute_area_completion, _spawn_next_occurrence
from app.crud.activity import log_activity
from app.db.session import get_db
from app.models.facilities import Asset, MaintenanceRequest
from app.models.kitchen import ProposedMenu, WasteLog, WasteLogLine, WeeklyMealPlan
from app.models.people import LeaveRequest, StaffProfile
from app.models.purchasing import PurchaseOrder, PurchaseRequest, PurchaseRequestLine
from app.models.tasks import Task, TaskChecklistItem, TaskComment
from app.models.user import User
from app.services import workflow

router = APIRouter(prefix="/approvals", tags=["approvals"])


@router.get("")
async def list_approvals(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Unified inbox: a query across PRs, POs, menu proposals, assets and
    leave — a view, not a stored table (build plan §03, §04)."""
    out = []

    prs = (
        await db.execute(select(PurchaseRequest).where(PurchaseRequest.status == workflow.SUBMITTED))
    ).scalars().all()
    for pr in prs:
        lines = (
            await db.execute(select(PurchaseRequestLine).where(PurchaseRequestLine.pr_id == pr.id))
        ).scalars().all()
        total_est = sum(float(l.est_cost) for l in lines)
        first_item = lines[0].item_name if lines else "empty request"
        title = first_item if len(lines) <= 1 else f"{first_item} +{len(lines) - 1} more"
        out.append(
            {
                "type": "purchase_request", "id": pr.id, "title": f"Purchase request — {title}",
                "sub": f"{len(lines)} item(s) · est. {total_est:.2f}", "date": pr.request_date.isoformat(),
            }
        )

    pos = (
        await db.execute(select(PurchaseOrder).where(PurchaseOrder.status == workflow.SUBMITTED))
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
        await db.execute(select(WeeklyMealPlan).where(WeeklyMealPlan.status == workflow.SUBMITTED))
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
        await db.execute(select(WasteLog).where(WasteLog.status == workflow.SUBMITTED))
    ).scalars().all()
    waste_doctype = workflow.get_doctype("waste_log")
    for waste in waste_logs:
        # Only approvers (owner, manager, the logger's supervisor) are pinged.
        if not await workflow.is_approver(db, user, waste, waste_doctype):
            continue
        line_count = (
            await db.execute(select(WasteLogLine).where(WasteLogLine.waste_log_id == waste.id))
        ).scalars().all()
        out.append(
            {
                "type": "waste_log", "id": waste.id, "title": f"Waste log {waste.code} — {waste.reason}",
                "sub": f"{len(line_count)} item(s) logged", "date": waste.date.isoformat(),
            }
        )

    return out


DECISION_MODELS = {
    # purchase_request and purchase_order are deliberately NOT here — they
    # go through the workflow engine (custom branches in decide() below) so
    # this path and purchasing.py's own decision endpoints can't drift apart.
    "proposed_menu": (ProposedMenu, {"approve": "Approved", "reject": "Rejected"}),
    "asset": (Asset, {"approve": "Approved", "reject": "Rejected"}),
    "leave_request": (LeaveRequest, {"approve": "Approved", "reject": "Rejected"}),
    # Rejecting bounces a weekly meal plan straight back to Draft so it can
    # be edited and resubmitted, rather than a dead-end "Rejected" status.
    "weekly_meal_plan": (WeeklyMealPlan, {"approve": "Approved", "reject": "Draft"}),
}

STATUS_FIELD = {
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
        await decide_po(db, po, user, approve)
        await db.commit()
        return {"ok": True, "status": po.status}

    if item_type == "purchase_request":
        pr = await db.get(PurchaseRequest, item_id)
        if not pr:
            raise HTTPException(404, "Purchase request not found")
        new_status = await workflow.apply_action(
            db, workflow.get_doctype("purchase_request"), pr, "approve" if approve else "reject", user,
            None if approve else "Rejected from the approvals inbox",
        )
        await db.commit()
        return {"ok": True, "status": new_status}

    if item_type == "waste_log":
        waste = await db.get(WasteLog, item_id)
        if not waste:
            raise HTTPException(404, "Waste log not found")
        # Approve signs it off; reject reverses the stock deduction and
        # returns it to Draft (see app/services/workflow.py).
        new_status = await workflow.apply_action(
            db, workflow.get_doctype("waste_log"), waste, "approve" if approve else "reject", user,
            None if approve else "Rejected from the approvals inbox",
        )
        if approve:
            waste.reviewed_by = user.id
        await db.commit()
        return {"ok": True, "status": new_status}

    if item_type not in DECISION_MODELS:
        raise HTTPException(404, "Unknown approval type")
    model, statuses = DECISION_MODELS[item_type]
    obj = await db.get(model, item_id)
    if not obj:
        raise HTTPException(404, "Item not found")
    if item_type == "weekly_meal_plan":
        if obj.status != workflow.SUBMITTED:
            raise HTTPException(400, f"Only a Submitted meal plan can be decided (this is {obj.status})")
        if approve:
            obj.approved_by, obj.approved_at = user.id, datetime.now(timezone.utc)
    new_status = statuses["approve"] if approve else statuses["reject"]
    setattr(obj, STATUS_FIELD[item_type], new_status)
    await log_activity(db, user, f"{new_status} {item_type.replace('_', ' ')}", str(item_id))
    await db.commit()
    return {"ok": True, "status": new_status}

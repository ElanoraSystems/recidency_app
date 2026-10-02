import uuid
from calendar import monthrange
from datetime import date, time, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import local_today
from app.api.deps import require_module
from app.crud.activity import log_activity
from app.db.session import get_db
from app.models.facilities import Area
from app.models.tasks import Task, TaskChecklistItem, TaskComment
from app.models.user import User

router = APIRouter(prefix="/tasks", tags=["tasks"])
tasks_access = require_module("tasks")


class ChecklistItemIn(BaseModel):
    text: str
    done: bool = False
    # Optional scheduled block for this specific item — a task's checklist
    # can cover several activities at different times of day, so timing
    # lives per item rather than once for the whole task. When both are
    # set, create_task() rejects any overlap with the same assignee's other
    # scheduled checklist items on the same day (see _check_overlap).
    start_time: time | None = None
    end_time: time | None = None


class TaskIn(BaseModel):
    title: str
    category: str
    description: str | None = None
    assignee_id: uuid.UUID | None = None
    location_id: uuid.UUID | None = None
    priority: str = "Medium"
    due_date: date
    recurrence: str = "One-time"
    recurrence_interval_days: int | None = None
    # False means a staff member marking it Completed is the final word — no
    # supervisor sign-off needed. True (the default) keeps today's behavior:
    # it routes through Approvals before counting as done.
    requires_verification: bool = True
    checklist: list[ChecklistItemIn] = []


class ChecklistItemOut(ChecklistItemIn):
    id: uuid.UUID

    class Config:
        from_attributes = True


class CommentOut(BaseModel):
    id: uuid.UUID
    author_name: str
    text: str
    at: date

    class Config:
        from_attributes = True


class TaskOut(BaseModel):
    id: uuid.UUID
    title: str
    category: str
    description: str | None
    assignee_id: uuid.UUID | None
    location_id: uuid.UUID | None
    priority: str
    due_date: date
    recurrence: str
    recurrence_interval_days: int | None
    requires_verification: bool
    status: str
    verified: bool
    photos: int
    checklist: list[ChecklistItemOut]
    comments: list[CommentOut]

    class Config:
        from_attributes = True


async def _task_out(db: AsyncSession, task: Task) -> TaskOut:
    checklist = (
        await db.execute(select(TaskChecklistItem).where(TaskChecklistItem.task_id == task.id))
    ).scalars().all()
    comments = (
        await db.execute(
            select(TaskComment).where(TaskComment.task_id == task.id).order_by(TaskComment.at)
        )
    ).scalars().all()
    return TaskOut(
        id=task.id,
        title=task.title,
        category=task.category,
        description=task.description,
        assignee_id=task.assignee_id,
        location_id=task.location_id,
        priority=task.priority,
        due_date=task.due_date,
        recurrence=task.recurrence,
        recurrence_interval_days=task.recurrence_interval_days,
        requires_verification=task.requires_verification,
        status=task.status,
        verified=task.verified,
        photos=task.photos,
        checklist=checklist,
        comments=comments,
    )


async def _recompute_area_completion(db: AsyncSession, area_id: uuid.UUID | None) -> None:
    """Housekeeping's per-area completion % is a live rollup of this area's
    Housekeeping-category tasks due in the trailing 7 days — not a manually-set
    value. Call this whenever a linked task is created or its status changes
    (see also approvals.py's task_review decision, the other status-change path).

    A task counts once it's relevant: either already due (due_date <= today,
    whether done or still outstanding) or already done ahead of its due date
    (Completed/Verified). A task that's neither due yet nor done yet isn't
    counted either way — it hasn't become relevant. Both sides are still
    bounded to a 13-day window centered on today so old history doesn't
    accumulate forever."""
    if not area_id:
        return
    area = await db.get(Area, area_id)
    if not area:
        return
    today = local_today()
    window_start = today - timedelta(days=6)
    window_end = today + timedelta(days=6)
    tasks = (
        await db.execute(
            select(Task).where(
                Task.location_id == area_id,
                Task.category == "Housekeeping",
                Task.due_date >= window_start,
                Task.due_date <= window_end,
                or_(Task.due_date <= today, Task.status.in_(("Completed", "Verified"))),
            )
        )
    ).scalars().all()
    if not tasks:
        area.completion = 0
        area.completion_tasks_done = 0
        area.completion_tasks_total = 0
        return
    done = sum(1 for t in tasks if t.status in ("Completed", "Verified"))
    area.completion = round(done / len(tasks) * 100)
    area.completion_tasks_done = done
    area.completion_tasks_total = len(tasks)


async def _check_overlap(
    db: AsyncSession, assignee_id: uuid.UUID, due_date: date, start_time: time, end_time: time,
    exclude_task_id: uuid.UUID | None = None,
) -> tuple[str, time, time] | None:
    """Returns (task_title, start, end) of the first conflicting checklist
    item scheduled for this staff member on this day, or None. Two ranges
    overlap iff each starts before the other ends. Timing lives per
    checklist item now, not on the task itself, so this joins through."""
    stmt = (
        select(Task.title, TaskChecklistItem.start_time, TaskChecklistItem.end_time)
        .join(TaskChecklistItem, TaskChecklistItem.task_id == Task.id)
        .where(
            Task.assignee_id == assignee_id,
            Task.due_date == due_date,
            TaskChecklistItem.start_time.is_not(None),
            TaskChecklistItem.end_time.is_not(None),
            and_(TaskChecklistItem.start_time < end_time, TaskChecklistItem.end_time > start_time),
        )
    )
    if exclude_task_id:
        stmt = stmt.where(Task.id != exclude_task_id)
    result = await db.execute(stmt)
    return result.first()


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
    checklist = (
        await db.execute(select(TaskChecklistItem).where(TaskChecklistItem.task_id == task.id))
    ).scalars().all()
    if task.assignee_id:
        for item in checklist:
            if item.start_time and item.end_time:
                conflict = await _check_overlap(db, task.assignee_id, next_due, item.start_time, item.end_time)
                if conflict:
                    await log_activity(
                        db, user, "Skipped next recurring occurrence — schedule conflict",
                        f"{task.title} — would repeat on {next_due}",
                    )
                    return
    next_task = Task(
        title=task.title, category=task.category, description=task.description,
        assignee_id=task.assignee_id, location_id=task.location_id, priority=task.priority,
        due_date=next_due,
        recurrence=task.recurrence, recurrence_interval_days=task.recurrence_interval_days,
        requires_verification=task.requires_verification,
        status="Pending",
    )
    db.add(next_task)
    await db.flush()
    for item in checklist:
        db.add(TaskChecklistItem(
            task_id=next_task.id, text=item.text, done=False,
            start_time=item.start_time, end_time=item.end_time,
        ))
    if next_task.category == "Housekeeping":
        await _recompute_area_completion(db, next_task.location_id)
    await log_activity(db, user, "Created next recurring occurrence", f"{task.title} — due {next_due}")


@router.get("", response_model=list[TaskOut])
async def list_tasks(db: AsyncSession = Depends(get_db), _user: User = Depends(tasks_access)):
    result = await db.execute(select(Task).order_by(Task.due_date))
    return [await _task_out(db, t) for t in result.scalars().all()]


@router.delete("/{task_id}", status_code=204)
async def delete_task(
    task_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(tasks_access)
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    await db.delete(task)
    await db.commit()


@router.post("", response_model=TaskOut, status_code=201)
async def create_task(
    payload: TaskIn, db: AsyncSession = Depends(get_db), _user: User = Depends(tasks_access)
):
    scheduled_items = [i for i in payload.checklist if i.start_time and i.end_time]
    for item in scheduled_items:
        if item.start_time >= item.end_time:
            raise HTTPException(400, f"'{item.text}': end time must be after start time")
    # Check the new items against each other (this same submission) before
    # checking against what's already in the DB.
    for i, a in enumerate(scheduled_items):
        for b in scheduled_items[i + 1:]:
            if a.start_time < b.end_time and b.start_time < a.end_time:
                raise HTTPException(400, f"'{a.text}' and '{b.text}' overlap on this task")
    if payload.assignee_id:
        for item in scheduled_items:
            conflict = await _check_overlap(db, payload.assignee_id, payload.due_date, item.start_time, item.end_time)
            if conflict:
                title, cstart, cend = conflict
                raise HTTPException(
                    409,
                    f"'{item.text}' ({item.start_time.strftime('%H:%M')}–{item.end_time.strftime('%H:%M')}) overlaps "
                    f"'{title}' ({cstart.strftime('%H:%M')}–{cend.strftime('%H:%M')}) already scheduled for this "
                    f"staff member on {payload.due_date}.",
                )

    task = Task(
        title=payload.title,
        category=payload.category,
        description=payload.description,
        assignee_id=payload.assignee_id,
        location_id=payload.location_id,
        priority=payload.priority,
        due_date=payload.due_date,
        recurrence=payload.recurrence,
        recurrence_interval_days=payload.recurrence_interval_days,
        requires_verification=payload.requires_verification,
        status="Pending",
    )
    db.add(task)
    await db.flush()
    for item in payload.checklist:
        db.add(TaskChecklistItem(
            task_id=task.id, text=item.text, done=item.done,
            start_time=item.start_time, end_time=item.end_time,
        ))
    if payload.category == "Housekeeping":
        await _recompute_area_completion(db, payload.location_id)
    await db.commit()
    await db.refresh(task)
    return await _task_out(db, task)


@router.patch("/{task_id}/status", response_model=TaskOut)
async def update_task_status(
    task_id: uuid.UUID,
    status_value: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(tasks_access),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    if status_value == "Verified" and task.requires_verification:
        raise HTTPException(
            400,
            "Completed tasks are verified through the supervisor review in Approvals, "
            "not set directly.",
        )
    # A task that doesn't require verification skips the Approvals review
    # entirely — marking it Completed IS the final word, so it lands
    # straight on Verified instead of sitting in Completed limbo waiting
    # for a review step that will never come.
    if status_value == "Completed" and not task.requires_verification:
        task.status = "Verified"
        task.verified = True
    else:
        task.status = status_value
        task.verified = False
    if task.category == "Housekeeping":
        await _recompute_area_completion(db, task.location_id)
    if task.status == "Verified" and task.recurrence != "One-time":
        await _spawn_next_occurrence(db, task, user)
    await db.commit()
    await db.refresh(task)
    return await _task_out(db, task)


@router.patch("/{task_id}/checklist/{item_id}", response_model=TaskOut)
async def toggle_checklist_item(
    task_id: uuid.UUID,
    item_id: uuid.UUID,
    done: bool,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(tasks_access),
):
    item = await db.get(TaskChecklistItem, item_id)
    if not item or item.task_id != task_id:
        raise HTTPException(404, "Checklist item not found")
    item.done = done
    await db.commit()
    task = await db.get(Task, task_id)
    return await _task_out(db, task)


@router.post("/{task_id}/comments", response_model=TaskOut)
async def add_comment(
    task_id: uuid.UUID,
    text: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(tasks_access),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    db.add(TaskComment(task_id=task_id, author_name=user.name, text=text, at=local_today()))
    await db.commit()
    return await _task_out(db, task)

import uuid
from datetime import date, time, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_module
from app.db.session import get_db
from app.models.facilities import Area
from app.models.tasks import Task, TaskChecklistItem, TaskComment
from app.models.user import User

router = APIRouter(prefix="/tasks", tags=["tasks"])
tasks_access = require_module("tasks")


class ChecklistItemIn(BaseModel):
    text: str
    done: bool = False


class TaskIn(BaseModel):
    title: str
    category: str
    description: str | None = None
    assignee_id: uuid.UUID | None = None
    location_id: uuid.UUID | None = None
    priority: str = "Medium"
    due_date: date
    due_time: time | None = None
    start_time: time | None = None
    end_time: time | None = None
    recurrence: str = "One-time"
    recurrence_interval_days: int | None = None
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
    due_time: time | None
    start_time: time | None
    end_time: time | None
    recurrence: str
    recurrence_interval_days: int | None
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
        due_time=task.due_time,
        start_time=task.start_time,
        end_time=task.end_time,
        recurrence=task.recurrence,
        recurrence_interval_days=task.recurrence_interval_days,
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
    today = date.today()
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
) -> Task | None:
    """Returns the first conflicting task for this staff member on this day,
    or None. Two ranges overlap iff each starts before the other ends."""
    stmt = select(Task).where(
        Task.assignee_id == assignee_id,
        Task.due_date == due_date,
        Task.start_time.is_not(None),
        Task.end_time.is_not(None),
        and_(Task.start_time < end_time, Task.end_time > start_time),
    )
    if exclude_task_id:
        stmt = stmt.where(Task.id != exclude_task_id)
    result = await db.execute(stmt)
    return result.scalars().first()


@router.get("", response_model=list[TaskOut])
async def list_tasks(db: AsyncSession = Depends(get_db), _user: User = Depends(tasks_access)):
    result = await db.execute(select(Task).order_by(Task.due_date))
    return [await _task_out(db, t) for t in result.scalars().all()]


@router.post("", response_model=TaskOut, status_code=201)
async def create_task(
    payload: TaskIn, db: AsyncSession = Depends(get_db), _user: User = Depends(tasks_access)
):
    if payload.assignee_id and payload.start_time and payload.end_time:
        if payload.start_time >= payload.end_time:
            raise HTTPException(400, "End time must be after start time")
        conflict = await _check_overlap(
            db, payload.assignee_id, payload.due_date, payload.start_time, payload.end_time
        )
        if conflict:
            raise HTTPException(
                409,
                f"This staff member already has '{conflict.title}' scheduled "
                f"{conflict.start_time.strftime('%H:%M')}–{conflict.end_time.strftime('%H:%M')} "
                f"on {payload.due_date} — that overlaps the requested time.",
            )

    task = Task(
        title=payload.title,
        category=payload.category,
        description=payload.description,
        assignee_id=payload.assignee_id,
        location_id=payload.location_id,
        priority=payload.priority,
        due_date=payload.due_date,
        due_time=payload.due_time,
        start_time=payload.start_time,
        end_time=payload.end_time,
        recurrence=payload.recurrence,
        recurrence_interval_days=payload.recurrence_interval_days,
        status="Pending",
    )
    db.add(task)
    await db.flush()
    for item in payload.checklist:
        db.add(TaskChecklistItem(task_id=task.id, text=item.text, done=item.done))
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
    _user: User = Depends(tasks_access),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    if status_value == "Verified":
        raise HTTPException(
            400,
            "Completed tasks are verified through the supervisor review in Approvals, "
            "not set directly.",
        )
    task.status = status_value
    task.verified = False
    if task.category == "Housekeeping":
        await _recompute_area_completion(db, task.location_id)
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
    db.add(TaskComment(task_id=task_id, author_name=user.name, text=text, at=date.today()))
    await db.commit()
    return await _task_out(db, task)

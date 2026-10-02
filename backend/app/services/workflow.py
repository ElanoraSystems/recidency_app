"""Standard transaction workflow: Draft -> Submitted -> Approved -> Closed.

* Draft: no stock effect, freely editable.
* Submit: runs the document's post hook (stock moves; fails whole if a
  location lacks stock).
* Approve / Close: sign-offs by an approver.
* Reject (Submitted only) and Reopen undo the posting by appending reversing
  ledger rows and return the document to Draft, where it can be edited and
  resubmitted. Reopening an Approved or Closed document needs the Super User
  (the owner) and a reason, so closed records are never silently changed.

Every step writes an audit_log row."""

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Awaitable, Callable

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.activity import log_activity
from app.models.people import StaffProfile
from app.models.user import Role, User
from app.services import audit, stock

DRAFT, SUBMITTED, APPROVED, CLOSED = "Draft", "Submitted", "Approved", "Closed"
ACTIONS = ("submit", "approve", "reject", "close", "reopen")
APPROVER_ROLE_KEYS = {"manager"}

Hook = Callable[[AsyncSession, object, User], Awaitable[None]]


@dataclass
class DocType:
    entity_type: str
    label: str
    model: type
    module: str
    post: Hook
    unpost: Hook | None = None
    creator_attr: str = "logged_by"


_REGISTRY: dict[str, DocType] = {}


def register(doctype: DocType) -> None:
    _REGISTRY[doctype.entity_type] = doctype


def get_doctype(entity_type: str) -> DocType:
    doctype = _REGISTRY.get(entity_type)
    if not doctype:
        raise HTTPException(404, f"Unknown transaction type '{entity_type}'")
    return doctype


def is_super_user(user: User) -> bool:
    return user.user_type == "owner"


async def is_approver(db: AsyncSession, user: User, obj, doctype: DocType) -> bool:
    """Owner, a manager role, or the creator's defined supervisor."""
    if is_super_user(user):
        return True
    if user.role_id:
        role = await db.get(Role, user.role_id)
        if role and role.key in APPROVER_ROLE_KEYS:
            return True
    creator_id = getattr(obj, doctype.creator_attr, None)
    if not creator_id:
        return False
    creator = (await db.execute(select(StaffProfile).where(StaffProfile.user_id == creator_id))).scalar_one_or_none()
    me = (await db.execute(select(StaffProfile).where(StaffProfile.user_id == user.id))).scalar_one_or_none()
    return bool(creator and me and creator.supervisor_id == me.id)


def ensure_editable(obj, user: User) -> None:
    if obj.status == DRAFT:
        return
    if obj.status == CLOSED and not is_super_user(user):
        raise HTTPException(403, "This transaction is Closed - Super User authorization is required to reopen it")
    raise HTTPException(409, f"This transaction is {obj.status}; reopen it to Draft before editing")


def _clear_signoffs(obj) -> None:
    obj.submitted_by = obj.submitted_at = None
    obj.approved_by = obj.approved_at = None
    obj.closed_by = obj.closed_at = None


async def apply_action(
    db: AsyncSession, doctype: DocType, obj, action: str, user: User, reason: str | None = None
) -> str:
    if action not in ACTIONS:
        raise HTTPException(400, f"Unknown action '{action}'")
    before = obj.status
    now = datetime.now(timezone.utc)
    reason = (reason or "").strip() or None

    if action == "submit":
        if before != DRAFT:
            raise HTTPException(400, f"Only a Draft can be submitted (this is {before})")
        await doctype.post(db, obj, user)
        obj.status, obj.submitted_by, obj.submitted_at = SUBMITTED, user.id, now

    elif action in ("approve", "close"):
        required = SUBMITTED if action == "approve" else APPROVED
        if before != required:
            raise HTTPException(400, f"Only a {required} transaction can be {action}d (this is {before})")
        if not await is_approver(db, user, obj, doctype):
            raise HTTPException(403, f"Only an approver (owner, manager or the creator's supervisor) can {action}")
        if action == "approve":
            obj.status, obj.approved_by, obj.approved_at = APPROVED, user.id, now
        else:
            obj.status, obj.closed_by, obj.closed_at = CLOSED, user.id, now

    else:  # reject | reopen: both undo the posting and return to Draft
        if before == DRAFT:
            raise HTTPException(400, "This transaction is already a Draft")
        if action == "reject":
            if before != SUBMITTED:
                raise HTTPException(400, "Only a Submitted transaction can be rejected; use Reopen")
            if not await is_approver(db, user, obj, doctype):
                raise HTTPException(403, "Only an approver can reject")
            if not reason:
                raise HTTPException(400, "A reason is required to reject")
        elif before == SUBMITTED:
            creator_id = getattr(obj, doctype.creator_attr, None)
            if creator_id != user.id and not await is_approver(db, user, obj, doctype):
                raise HTTPException(403, "Only the creator or an approver can reopen a submitted transaction")
        else:
            if not is_super_user(user):
                raise HTTPException(403, f"Reopening an {before} transaction requires Super User authorization")
            if not reason:
                raise HTTPException(400, "A reason is required to reopen")
        await stock.reverse_txn(db, obj.id, user)
        if doctype.unpost:
            await doctype.unpost(db, obj, user)
        obj.status = DRAFT
        _clear_signoffs(obj)

    code = getattr(obj, "code", None)
    await audit.record(
        db, user, doctype.entity_type, obj.id, code, action, from_status=before, to_status=obj.status, reason=reason
    )
    await log_activity(db, user, f"{doctype.label}: {action}", f"{code} ({before} -> {obj.status})")
    return obj.status

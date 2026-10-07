import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import undefer

from app.core.clock import local_today
from app.api.deps import _user_allowed_modules, get_current_user
from app.db.session import get_db
from app.models.facilities import Attachment
from app.models.user import User
from app.services.files import file_response, read_upload

router = APIRouter(prefix="/attachments", tags=["attachments"])

ENTITY_MODULES = {"asset": "maintenance", "maintenance_request": "maintenance", "task": "tasks", "expense": "expenses"}


async def _check_access(entity_type: str, user: User, db: AsyncSession) -> None:
    module = ENTITY_MODULES.get(entity_type)
    if not module:
        raise HTTPException(404, "Unknown attachment entity type")
    if user.user_type == "owner":
        return
    allowed = await _user_allowed_modules(user, db)
    if module not in allowed:
        raise HTTPException(403, f"No access to module '{module}'")


@router.post("/{entity_type}/{entity_id}/files", status_code=201)
async def upload_attachment(
    entity_type: str,
    entity_id: uuid.UUID,
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _check_access(entity_type, user, db)
    contents = await read_upload(file)
    record = Attachment(
        entity_type=entity_type,
        entity_id=entity_id,
        s3_key=f"db/{entity_type}/{entity_id}/{uuid.uuid4()}",
        data=contents,
        filename=file.filename or "file",
        content_type=file.content_type,
        size_bytes=len(contents),
        uploaded_by=user.id,
        uploaded_at=local_today(),
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return {"id": record.id, "filename": record.filename, "size_bytes": record.size_bytes}


@router.get("/{entity_type}/{entity_id}/files")
async def list_attachments(
    entity_type: str,
    entity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _check_access(entity_type, user, db)
    result = await db.execute(
        select(Attachment).where(Attachment.entity_type == entity_type, Attachment.entity_id == entity_id)
    )
    files = result.scalars().all()
    return [
        {"id": f.id, "filename": f.filename, "size_bytes": f.size_bytes, "uploaded_at": f.uploaded_at}
        for f in files
    ]


@router.get("/files/{file_id}/download")
async def download_attachment(
    file_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    record = (await db.execute(select(Attachment).options(undefer(Attachment.data)).where(Attachment.id == file_id))).scalar_one_or_none()
    if not record:
        raise HTTPException(404, "File not found")
    await _check_access(record.entity_type, user, db)
    return file_response(record.data, record.s3_key, record.filename, record.content_type)

import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from app.core.clock import local_today
from app.api.deps import require_module
from app.db.session import get_db
from app.models.finance import Document, DocumentFile
from app.models.user import User
from app.services.files import file_response, read_upload

router = APIRouter(prefix="/documents", tags=["documents"])
documents_access = require_module("documents")


@router.post("/{document_id}/files", status_code=201)
async def upload_document_file(
    document_id: uuid.UUID,
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(documents_access),
):
    """The file is stored in the database (the host has no persistent disk);
    swap for boto3 presigned PUT/GET if an S3 bucket is ever configured."""
    document = await db.get(Document, document_id)
    if not document:
        raise HTTPException(404, "Document not found")

    contents = await read_upload(file)
    record = DocumentFile(
        document_id=document_id,
        s3_key=f"db/documents/{document_id}/{uuid.uuid4()}",
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


@router.get("/{document_id}/files")
async def list_document_files(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(documents_access),
):
    result = await db.execute(select(DocumentFile).where(DocumentFile.document_id == document_id))
    files = result.scalars().all()
    return [
        {"id": f.id, "filename": f.filename, "size_bytes": f.size_bytes, "uploaded_at": f.uploaded_at}
        for f in files
    ]


@router.get("/files/{file_id}/download")
async def download_document_file(
    file_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(documents_access)
):
    record = (await db.execute(select(DocumentFile).options(undefer(DocumentFile.data)).where(DocumentFile.id == file_id))).scalar_one_or_none()
    if not record:
        raise HTTPException(404, "File not found")
    return file_response(record.data, record.s3_key, record.filename, record.content_type)

import uuid
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_module
from app.db.session import get_db
from app.models.finance import Document, DocumentFile
from app.models.user import User

router = APIRouter(prefix="/documents", tags=["documents"])
documents_access = require_module("documents")

UPLOAD_ROOT = Path(__file__).resolve().parents[3] / "uploads"


@router.post("/{document_id}/files", status_code=201)
async def upload_document_file(
    document_id: uuid.UUID,
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(documents_access),
):
    """Local-disk fallback for the build plan's S3-presigned-URL flow (§05) —
    same key convention, swap this for boto3 presigned PUT/GET when an
    S3_BUCKET is configured."""
    document = await db.get(Document, document_id)
    if not document:
        raise HTTPException(404, "Document not found")

    key = f"residence/documents/{document_id}/{uuid.uuid4()}-{file.filename}"
    dest = UPLOAD_ROOT / key
    dest.parent.mkdir(parents=True, exist_ok=True)
    contents = await file.read()
    dest.write_bytes(contents)

    record = DocumentFile(
        document_id=document_id,
        s3_key=key,
        filename=file.filename or "file",
        content_type=file.content_type,
        size_bytes=len(contents),
        uploaded_by=user.id,
        uploaded_at=date.today(),
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
    record = await db.get(DocumentFile, file_id)
    if not record:
        raise HTTPException(404, "File not found")
    path = UPLOAD_ROOT / record.s3_key
    if not path.exists():
        raise HTTPException(404, "File missing on disk")
    return FileResponse(path, filename=record.filename, media_type=record.content_type)

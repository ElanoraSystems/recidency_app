"""Uploaded files live in the database, not on the server's disk.

The host has no persistent disk, so anything written to a folder on the server
disappears on each deploy. File bytes are kept in a `data` column next to the
record that describes them, which survives deploys and is covered by the
database's own backups.

Files uploaded before this change were written to disk; `file_response` still
serves one of those if its bytes were never copied into the database and the
file is still there.
"""

from pathlib import Path
from urllib.parse import quote

from fastapi import HTTPException, Response, UploadFile
from fastapi.responses import FileResponse

UPLOAD_ROOT = Path(__file__).resolve().parent.parent.parent / "uploads"
MAX_UPLOAD_BYTES = 25 * 1024 * 1024


async def read_upload(file: UploadFile) -> bytes:
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"That file is too large ({MAX_UPLOAD_BYTES // (1024 * 1024)} MB at most)")
    if not data:
        raise HTTPException(400, "That file is empty")
    return data


def file_response(data: bytes | None, legacy_key: str | None, filename: str, media_type: str | None, attachment: bool = True):
    """Serves stored bytes; falls back to a pre-migration file on disk."""
    if data is not None:
        headers = {"Content-Disposition": f"{'attachment' if attachment else 'inline'}; filename*=UTF-8''{quote(filename)}"}
        return Response(bytes(data), media_type=media_type or "application/octet-stream", headers=headers)
    path = UPLOAD_ROOT / legacy_key if legacy_key else None
    if path and path.is_file():
        return FileResponse(path, filename=filename, media_type=media_type)
    raise HTTPException(404, "This file is no longer stored. Please upload it again.")

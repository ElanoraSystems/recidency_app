"""Recipe photos, stored compressed in the database.

The host has no persistent disk, so files written to the server vanish on each
deploy; a few hundred KB per picture in Postgres survives. The browser crops
and shrinks every picture before upload; the checks here are a backstop.

Reading a picture needs no login on purpose: an <img> tag cannot send the
bearer token, and each id is an unguessable UUID. Writing needs kitchen access.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_module
from app.crud.activity import log_activity
from app.db.session import get_db
from app.models.kitchen import Recipe, RecipePhoto
from app.models.user import User

router = APIRouter(prefix="/kitchen", tags=["kitchen"])
kitchen_access = require_module("kitchen")

MAX_PHOTOS = 4
MAX_BYTES = 2 * 1024 * 1024
# content type -> the first bytes a real file of that type starts with
SIGNATURES = {"image/jpeg": b"\xff\xd8\xff", "image/png": b"\x89PNG", "image/webp": b"RIFF"}


async def _recipe(db: AsyncSession, recipe_id: uuid.UUID) -> Recipe:
    recipe = await db.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(404, "Recipe not found")
    return recipe


async def _ids(db: AsyncSession, recipe_id: uuid.UUID) -> list[uuid.UUID]:
    rows = await db.execute(
        select(RecipePhoto.id).where(RecipePhoto.recipe_id == recipe_id).order_by(RecipePhoto.position, RecipePhoto.created_at)
    )
    return list(rows.scalars().all())


async def _renumber(db: AsyncSession, ordered: list[uuid.UUID]) -> None:
    for position, photo_id in enumerate(ordered):
        await db.execute(update(RecipePhoto).where(RecipePhoto.id == photo_id).values(position=position))


@router.post("/recipes/{recipe_id}/photos", response_model=list[uuid.UUID], status_code=201)
async def add_photo(
    recipe_id: uuid.UUID, file: UploadFile, db: AsyncSession = Depends(get_db), user: User = Depends(kitchen_access)
):
    recipe = await _recipe(db, recipe_id)
    kind = (file.content_type or "").lower()
    if kind not in SIGNATURES:
        raise HTTPException(400, "Photos must be JPEG, PNG or WebP")
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(400, "That photo is too large (2 MB at most)")
    if not data.startswith(SIGNATURES[kind]):
        raise HTTPException(400, "That file is not a valid image")
    existing = await _ids(db, recipe_id)
    if len(existing) >= MAX_PHOTOS:
        raise HTTPException(400, f"A recipe can have {MAX_PHOTOS} photos; delete one first")
    db.add(RecipePhoto(recipe_id=recipe_id, position=len(existing), content_type=kind, data=data))
    await log_activity(db, user, "Added recipe photo", recipe.name)
    await db.commit()
    return await _ids(db, recipe_id)


@router.get("/recipe-photos/{photo_id}")
async def get_photo(photo_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    photo = await db.get(RecipePhoto, photo_id)
    if not photo:
        raise HTTPException(404, "Photo not found")
    # A replaced picture gets a new id, so a stored copy never goes stale.
    return Response(photo.data, media_type=photo.content_type, headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.post("/recipes/{recipe_id}/photos/{photo_id}/cover", response_model=list[uuid.UUID])
async def make_cover(
    recipe_id: uuid.UUID, photo_id: uuid.UUID, db: AsyncSession = Depends(get_db), _user: User = Depends(kitchen_access)
):
    ids = await _ids(db, recipe_id)
    if photo_id not in ids:
        raise HTTPException(404, "Photo not found")
    await _renumber(db, [photo_id] + [i for i in ids if i != photo_id])
    await db.commit()
    return await _ids(db, recipe_id)


@router.delete("/recipes/{recipe_id}/photos/{photo_id}", response_model=list[uuid.UUID])
async def delete_photo(
    recipe_id: uuid.UUID, photo_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(kitchen_access)
):
    recipe = await _recipe(db, recipe_id)
    photo = await db.get(RecipePhoto, photo_id)
    if not photo or photo.recipe_id != recipe_id:
        raise HTTPException(404, "Photo not found")
    await db.delete(photo)
    await db.flush()
    await _renumber(db, await _ids(db, recipe_id))
    await log_activity(db, user, "Deleted recipe photo", recipe.name)
    await db.commit()
    return await _ids(db, recipe_id)

import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token
from app.db.session import get_db
from app.models.user import FamilyAccount, FamilyModuleAccess, RoleModuleAccess, User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


async def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_error
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise credentials_error
    try:
        user_id = uuid.UUID(payload.get("sub"))
    except (TypeError, ValueError):
        raise credentials_error
    user = await db.get(User, user_id)
    if not user or not user.active:
        raise credentials_error
    return user


async def _user_allowed_modules(user: User, db: AsyncSession) -> set[str]:
    if user.user_type in ("owner", "staff"):
        if not user.role_id:
            return set()
        result = await db.execute(
            select(RoleModuleAccess.module).where(RoleModuleAccess.role_id == user.role_id)
        )
        return set(result.scalars().all())
    if user.user_type == "family":
        result = await db.execute(select(FamilyAccount).where(FamilyAccount.user_id == user.id))
        account = result.scalar_one_or_none()
        if not account or not account.active:
            return set()
        result = await db.execute(
            select(FamilyModuleAccess.module).where(
                FamilyModuleAccess.family_account_id == account.id
            )
        )
        return set(result.scalars().all())
    return set()


def require_module(module: str):
    """Server-side version of the prototype's allowedNav() — the piece the
    prototype never actually had, since its RBAC was decorative (enforced only
    by which buttons rendered)."""

    async def dependency(
        user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
    ) -> User:
        if user.user_type == "owner":
            return user
        allowed = await _user_allowed_modules(user, db)
        if module not in allowed:
            raise HTTPException(status_code=403, detail=f"No access to module '{module}'")
        return user

    return dependency

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def next_code(db: AsyncSession, model, prefix: str, start: int) -> str:
    """Next sequential reference like 'ML-1007' for a model with a `code`
    column. Compares numerically (not lexically) and only considers codes
    carrying this prefix, so tables holding several schemes stay independent."""
    result = await db.execute(select(model.code).where(model.code.like(f"{prefix}-%")))
    numbers = []
    for (code,) in result.all():
        try:
            numbers.append(int(code.split("-", 1)[1]))
        except (IndexError, ValueError):
            continue
    return f"{prefix}-{max(numbers) + 1 if numbers else start}"

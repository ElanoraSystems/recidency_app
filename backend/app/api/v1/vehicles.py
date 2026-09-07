import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_module
from app.crud.activity import log_activity
from app.db.session import get_db
from app.models.facilities import Vehicle, VehicleHistory
from app.models.user import User

router = APIRouter(prefix="/vehicles", tags=["vehicles"])
vehicles_access = require_module("vehicles")


@router.post("/{vehicle_id}/log-service")
async def log_service(
    vehicle_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(vehicles_access)
):
    vehicle = await db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(404, "Vehicle not found")

    next_service = date.today() + timedelta(days=90)
    vehicle.last_service = date.today()
    vehicle.next_service = next_service
    db.add(VehicleHistory(
        vehicle_id=vehicle.id, date=date.today(), type="Service",
        description="Routine service logged", cost=75,
    ))

    await log_activity(db, user, "Logged vehicle service", vehicle.name)
    await db.commit()
    return {"id": vehicle.id, "last_service": vehicle.last_service, "next_service": vehicle.next_service}

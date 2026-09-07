from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import (
    activity_log,
    approvals,
    attachments,
    auth,
    dashboard,
    document_files,
    facilities,
    generic_routes,
    kitchen,
    maintenance,
    patrol,
    people,
    purchasing,
    settings as settings_router,
    tasks,
    vehicles,
)
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(title="Butler Hadlaan House API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PREFIX = "/api/v1"

app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(dashboard.router, prefix=API_PREFIX)
app.include_router(people.router, prefix=API_PREFIX)
app.include_router(kitchen.router, prefix=API_PREFIX)
app.include_router(purchasing.router, prefix=API_PREFIX)
app.include_router(purchasing.item_master_router, prefix=API_PREFIX)
app.include_router(facilities.router, prefix=API_PREFIX)
app.include_router(maintenance.router, prefix=API_PREFIX)
app.include_router(maintenance.pm_router, prefix=API_PREFIX)
app.include_router(vehicles.router, prefix=API_PREFIX)
app.include_router(tasks.router, prefix=API_PREFIX)
app.include_router(approvals.router, prefix=API_PREFIX)
app.include_router(patrol.router, prefix=API_PREFIX)
app.include_router(activity_log.router, prefix=API_PREFIX)
app.include_router(document_files.router, prefix=API_PREFIX)
app.include_router(attachments.router, prefix=API_PREFIX)
app.include_router(settings_router.router, prefix=API_PREFIX)
for r in generic_routes.routers:
    app.include_router(r, prefix=API_PREFIX)


@app.get("/health")
async def health():
    return {"status": "ok"}

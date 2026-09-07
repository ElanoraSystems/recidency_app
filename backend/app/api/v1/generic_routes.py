"""Assembles the generic CRUD routers for tables with no special business
logic. See app/crud/generic.py for what "generic" means here."""

from app.crud.generic import make_router
from app.models.facilities import Area, AreaType, Inspection, MaintenanceRequest, PmSchedule, Vehicle, VehicleHistory
from app.models.family_guests import Event, FamilyMember, Guest
from app.models.finance import Document, Expense
from app.models.kitchen import FoodInventory, MealCategory, WasteReason
from app.models.people import Attendance, LeaveRequest, Shift, ShiftPattern
from app.models.purchasing import Inventory, ItemMaster, Supplier, UnitOfMeasure
from app.models.tasks import GardenTask, PoolLog, TaskCategory, TaskTemplate

routers = [
    make_router(Area, prefix="/areas", tag="housekeeping", module="housekeeping", order_by="name"),
    make_router(AreaType, prefix="/area-types", tag="housekeeping", module="housekeeping", order_by="label"),
    make_router(Supplier, prefix="/suppliers", tag="purchasing", module="purchasing", order_by="name"),
    make_router(
        ItemMaster, prefix="/item-master", tag="purchasing", module="purchasing", order_by="name",
        read_only=True,  # write endpoints are hand-written in purchasing.py so
        # `code` is always server-generated, never taken from the client
    ),
    make_router(UnitOfMeasure, prefix="/units-of-measure", tag="purchasing", module="purchasing", order_by="label"),
    make_router(Inventory, prefix="/inventory", tag="inventory", module="inventory", order_by="name"),
    make_router(
        FoodInventory,
        prefix="/kitchen/food-inventory",
        tag="kitchen",
        module="kitchen",
        order_by="expiry",
    ),
    make_router(
        MaintenanceRequest,
        prefix="/maintenance-requests",
        tag="maintenance",
        module="maintenance",
        order_by="reported_date",
        read_only=True,  # write endpoints are hand-written in maintenance.py so
        # `reported_by` is always taken from the authenticated user, not the client
    ),
    make_router(PmSchedule, prefix="/pm-schedule", tag="maintenance", module="maintenance", order_by="due_date"),
    make_router(Inspection, prefix="/inspections", tag="housekeeping", module="housekeeping", order_by="date"),
    make_router(Vehicle, prefix="/vehicles", tag="vehicles", module="vehicles", order_by="name"),
    make_router(VehicleHistory, prefix="/vehicle-history", tag="vehicles", module="vehicles"),
    make_router(FamilyMember, prefix="/family-members", tag="guests", module="guests"),
    make_router(Guest, prefix="/guests", tag="guests", module="guests", order_by="arrival"),
    make_router(Expense, prefix="/expenses", tag="expenses", module="expenses", order_by="date"),
    make_router(Document, prefix="/documents", tag="documents", module="documents", order_by="expiry"),
    make_router(Attendance, prefix="/attendance", tag="people", module="people", order_by="date"),
    make_router(Shift, prefix="/shifts", tag="people", module="people"),
    make_router(ShiftPattern, prefix="/shift-patterns", tag="people", module="people", order_by="label"),
    make_router(LeaveRequest, prefix="/leave-requests", tag="people", module="people", order_by="from_date"),
    make_router(MealCategory, prefix="/kitchen/meal-categories", tag="kitchen", module="kitchen", order_by="label"),
    make_router(WasteReason, prefix="/kitchen/waste-reasons", tag="kitchen", module="kitchen", order_by="label"),
    make_router(Event, prefix="/events", tag="events", module="events", order_by="date"),
    make_router(TaskTemplate, prefix="/task-templates", tag="tasks", module="tasks"),
    make_router(TaskCategory, prefix="/task-categories", tag="tasks", module="tasks", order_by="label"),
    make_router(GardenTask, prefix="/garden-tasks", tag="gardenpool", module="gardenpool", order_by="next_due"),
    make_router(PoolLog, prefix="/pool-log", tag="gardenpool", module="gardenpool", order_by="date"),
]

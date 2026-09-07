"""Seeds the local database with data that mirrors the Hadlaan Residence
reference prototype (app.html) — same staff, roles, recipes, inventory,
purchasing chain, etc. — so the real full-stack app can be exercised end to
end locally.

Run with:  ./venv/bin/python -m app.seed
"""

import asyncio
from datetime import date, time, timedelta

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.facilities import Area, Asset, Inspection, MaintenanceRequest, PmSchedule, Vehicle, VehicleHistory
from app.models.family_guests import Event, FamilyMember, Guest
from app.models.finance import Document, Expense, ResidenceSettings
from app.models.governance import ActivityLog
from app.api.v1.kitchen import _load_uom_map, _resolve_ingredient_qty, compute_recipe_cost
from app.models.kitchen import FoodInventory, MealLog, MenuOption, ProposedMenu, Recipe, RecipeIngredient
from app.models.people import Attendance, LeaveRequest, Shift, StaffProfile
from app.models.purchasing import (
    Grn, GrnLine, Inventory, ItemMaster, PoLine, PurchaseOrder, PurchaseRequest, Supplier, UnitOfMeasure,
)
from app.models.tasks import GardenTask, PoolLog, Task, TaskChecklistItem, TaskTemplate
from app.models.user import FamilyAccount, FamilyModuleAccess, Role, RoleModuleAccess, User

DEV_PASSWORD = "password123"


def D(n: int) -> date:
    return date.today() + timedelta(days=n)


NAV = [
    "dashboard", "approvals", "people", "tasks", "housekeeping", "kitchen", "inventory",
    "purchasing", "maintenance", "vehicles", "gardenpool", "guests", "events", "expenses",
    "documents", "reports", "settings", "patrol",
]

ROLE_NAV = {
    "owner": NAV,
    "manager": ["dashboard", "approvals", "people", "tasks", "housekeeping", "kitchen", "inventory",
                "purchasing", "maintenance", "vehicles", "gardenpool", "guests", "events", "documents",
                "reports", "settings", "patrol"],
    "chef": ["dashboard", "tasks", "kitchen", "inventory", "purchasing", "documents"],
    "housekeeper": ["dashboard", "tasks", "housekeeping", "documents"],
    "driver": ["dashboard", "tasks", "vehicles", "documents"],
    "gardener": ["dashboard", "tasks", "gardenpool", "documents"],
    "maintenance": ["dashboard", "tasks", "maintenance", "inventory", "documents"],
    "accountant": ["dashboard", "purchasing", "expenses", "inventory", "documents", "reports"],
    "security": ["dashboard", "tasks", "documents", "patrol"],
}

ROLE_LABELS = {
    "owner": "Owner / Admin",
    "manager": "Residence Manager",
    "chef": "Chef",
    "housekeeper": "Housekeeper",
    "driver": "Driver",
    "gardener": "Gardener",
    "maintenance": "Maintenance Technician",
    "accountant": "Accountant",
    "security": "Security Guard",
}


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        already = (await db.execute(select(ResidenceSettings).limit(1))).scalar_one_or_none()
        if already:
            print("Database already seeded — skipping. Delete the volume to reseed.")
            return

        db.add(ResidenceSettings(
            name="Butler Hadlaan House", location="Kuwait City, Kuwait",
            currency="KWD", timezone="Asia/Kuwait", monthly_budget=6500,
        ))

        # ---------------------------------------------------------- roles --
        roles: dict[str, Role] = {}
        for key, modules in ROLE_NAV.items():
            role = Role(key=key, label=ROLE_LABELS[key])
            db.add(role)
            await db.flush()
            for m in modules:
                db.add(RoleModuleAccess(role_id=role.id, module=m))
            roles[key] = role

        # -------------------------------------------------- owner + staff --
        owner_user = User(
            user_type="owner", name="Intisar Salem Al Ali Al Sabah", email="owner@hadlaan.local",
            password_hash=hash_password(DEV_PASSWORD), role_id=roles["owner"].id,
        )
        db.add(owner_user)

        staff_defs = [
            ("Ramon Villanueva", "manager", "Residence Manager", "Management", "ramon.v@residence.local", 950, False),
            ("Aiko Tanaka", "chef", "Head Chef", "Kitchen", "aiko.t@residence.local", 820, False),
            ("Maria Santos", "housekeeper", "Lead Housekeeper", "Housekeeping", "maria.s@residence.local", 280, False),
            ("Josephine Cruz", "housekeeper", "Housekeeper", "Housekeeping", "josephine.c@residence.local", 250, False),
            ("Lakshmi Nair", "housekeeper", "Housekeeper", "Housekeeping", "lakshmi.n@residence.local", 250, False),
            ("Deepak Kumar", "driver", "Driver", "Transport", "deepak.k@residence.local", 300, False),
            ("Farhan Ali", "driver", "Driver", "Transport", "farhan.a@residence.local", 290, False),
            ("Wilson Mbeki", "gardener", "Gardener", "Grounds", "wilson.m@residence.local", 260, False),
            ("Yusuf Demir", "maintenance", "Maintenance Technician", "Maintenance", "yusuf.d@residence.local", 340, False),
            ("Camille Dubois", "accountant", "Accountant", "Administration", "camille.d@residence.local", 400, True),
        ]
        staff: dict[str, StaffProfile] = {}
        staff_users: dict[str, User] = {}
        for i, (name, role_key, position, dept, email, salary, offsite) in enumerate(staff_defs, start=1):
            user = User(
                user_type="staff", name=name, email=email, phone=f"+965 5{i:02d}0 {1000+i*3}",
                password_hash=hash_password(DEV_PASSWORD), role_id=roles[role_key].id,
            )
            db.add(user)
            await db.flush()
            profile = StaffProfile(
                user_id=user.id, position=position, department=dept, join_date=D(-1500 + i * 60),
                status="On Leave" if name == "Farhan Ali" else "Active", off_site_role=offsite,
                id_type="Passport", id_number=f"P{1000000+i}", id_expiry=D(300 + i * 20),
                contract_type="Full-time · 2yr renewable", contract_end=D(150 + i * 15),
                salary=salary, salary_currency="KWD",
                emergency_contact={"name": f"{name.split()[0]}'s contact", "relation": "Spouse", "phone": "+965 5000 0000"},
                responsibilities=["Daily duties", "Reporting to manager"],
                uniform=["Uniform set"], notes="",
            )
            db.add(profile)
            await db.flush()
            staff[f"stf-{i}"] = profile
            staff_users[f"stf-{i}"] = user

        for staff_id, sp in staff.items():
            u = staff_users[staff_id]
            present = sp.status == "Active" and not sp.off_site_role
            db.add(Attendance(
                staff_id=sp.id, date=D(0),
                check_in=None if not present else time(7, 30),
                status="Present" if present else ("On Leave" if sp.status == "On Leave" else "Absent"),
            ))

        db.add(LeaveRequest(staff_id=staff["stf-7"].id, type="Annual Leave", from_date=D(-2), to_date=D(3),
                             days=6, status="Approved", reason="Family visit", requested_on=D(-14)))
        db.add(LeaveRequest(staff_id=staff["stf-9"].id, type="Annual Leave", from_date=D(12), to_date=D(16),
                             days=5, status="Pending", reason="Travel home", requested_on=D(-1)))
        db.add(LeaveRequest(staff_id=staff["stf-5"].id, type="Emergency Leave", from_date=D(30), to_date=D(31),
                             days=2, status="Pending", reason="Personal matter", requested_on=D(0)))

        db.add(Shift(staff_id=staff["stf-1"].id, pattern={"mon": "07:00-15:00", "tue": "07:00-15:00", "fri": "Off"}))
        db.add(Shift(staff_id=staff["stf-2"].id, pattern={"mon": "06:00-14:00", "thu": "Off"}))

        # -------------------------------------------------------- family --
        family_defs = [
            ("Intisar Salem Al Ali Al Sabah", "Residence Owner", "No red meat", "None", "Prefers herbal tea."),
            ("Family Member — Spouse", "Spouse", "Low sodium", "Shellfish", "Evening coffee on the terrace."),
            ("Family Member — Daughter", "Daughter", "Vegetarian on weekdays", "Peanuts", "Piano room kept tidy."),
            ("Family Member — Son", "Son", "No restrictions", "None", "Football gear laundered daily."),
        ]
        family_members = []
        for name, relation, dietary, allergies, prefs in family_defs:
            fm = FamilyMember(name=name, relation=relation, dietary=dietary, allergies=allergies, preferences=prefs)
            db.add(fm)
            await db.flush()
            family_members.append(fm)

        spouse_user = User(user_type="family", name="Family Member — Spouse", email="spouse@hadlaan.local",
                            password_hash=hash_password(DEV_PASSWORD))
        db.add(spouse_user)
        await db.flush()
        spouse_account = FamilyAccount(user_id=spouse_user.id, family_member_id=family_members[1].id,
                                        relation="Spouse", active=True)
        db.add(spouse_account)
        await db.flush()
        for m in ["dashboard", "kitchen", "guests", "events", "documents", "expenses"]:
            db.add(FamilyModuleAccess(family_account_id=spouse_account.id, module=m))

        daughter_user = User(user_type="family", name="Family Member — Daughter", email="daughter@hadlaan.local",
                              password_hash=hash_password(DEV_PASSWORD))
        db.add(daughter_user)
        await db.flush()
        daughter_account = FamilyAccount(user_id=daughter_user.id, family_member_id=family_members[2].id,
                                          relation="Daughter", active=True)
        db.add(daughter_account)
        await db.flush()
        for m in ["dashboard", "guests", "events"]:
            db.add(FamilyModuleAccess(family_account_id=daughter_account.id, module=m))

        # --------------------------------------------------------- areas --
        area_defs = [
            ("Master Bedroom", "Bedrooms", 96, 75, "stf-3"), ("Guest Room 1", "Guest Rooms", 98, 100, "stf-5"),
            ("Guest Room 2", "Guest Rooms", 90, 60, "stf-5"), ("Guest Room 3", "Guest Rooms", 94, 100, "stf-5"),
            ("Living Room", "Living Areas", 92, 40, "stf-4"), ("Dining Room", "Living Areas", 88, 100, "stf-4"),
            ("Main Kitchen", "Kitchen", 97, 100, "stf-2"), ("Family Bathroom", "Bathrooms", 95, 100, "stf-3"),
            ("Home Office", "Office", 91, 0, "stf-4"), ("Majlis", "Living Areas", 93, 100, "stf-3"),
            ("Outdoor Terrace", "Outdoor", 89, 0, "stf-4"), ("Utility Yard", "Utility", None, 0, None),
            ("Utility Room", "Utility", None, 0, None), ("Laundry Room", "Utility", 94, 100, "stf-3"),
            ("Pool Plant Room", "Outdoor", None, 0, None), ("Garden Shed", "Outdoor", None, 0, None),
        ]
        areas: dict[str, Area] = {}
        for name, category, score, completion, assignee in area_defs:
            area = Area(name=name, category=category, checklist=["Dusting", "Vacuuming", "Mopping"],
                        last_score=score, last_inspected=D(-1) if score else None,
                        assignee_id=staff[assignee].id if assignee else None, completion=completion)
            db.add(area)
            await db.flush()
            areas[name] = area

        db.add(Inspection(area_id=areas["Guest Room 1"].id, score=98, inspector="Ramon Villanueva",
                           date=D(-1), notes="Excellent, ready for guests."))
        db.add(Inspection(area_id=areas["Dining Room"].id, score=88, inspector="Ramon Villanueva",
                           date=D(-2), notes="Minor dust on shelving."))

        # -------------------------------------------------------- kitchen --
        gulf_fresh = Supplier(name="Gulf Fresh Seafood", category="Seafood", contact="Yousef Al-Fadhli",
                               phone="+965 2244 7789", rating=4.9, since="2017")
        al_rawabi = Supplier(name="Al Rawabi Trading", category="Dry Goods & Spices", contact="Ahmad Saleh",
                              phone="+965 2211 0091", rating=4.6, since="2018")
        kdd = Supplier(name="KDD Dairy", category="Dairy", contact="Noura Hassan", phone="+965 2255 3391",
                       rating=4.7, since="2016")
        prime_meats = Supplier(name="Prime Meats Co.", category="Meat", contact="Omar Khaled",
                                phone="+965 2266 4451", rating=4.7, since="2020")
        green_valley = Supplier(name="Green Valley Produce", category="Garden & Fresh Produce", contact="Ali Mahmoud",
                                 phone="+965 2233 6612", rating=4.4, since="2019")
        sparkle = Supplier(name="Sparkle Supplies Co.", category="Cleaning & Toiletries", contact="Fahad Al-Otaibi",
                            phone="+965 2211 3344", rating=4.6, since="2019")
        estate_linens = Supplier(name="Estate Linens LLC", category="Linen", contact="Huda Marzouq",
                                  phone="+965 2299 8871", rating=4.8, since="2020")
        al_manar = Supplier(name="Al Manar Home", category="Kitchenware & Crockery", contact="Salem Al-Ghanim",
                             phone="+965 2255 1102", rating=4.7, since="2018")
        aquacare = Supplier(name="AquaCare Kuwait", category="Pool Supplies", contact="Noora Al-Sabah",
                             phone="+965 2277 9034", rating=4.5, since="2021")
        brightline = Supplier(name="BrightLine Electrical", category="Electrical", contact="Rania Nasser",
                               phone="+965 2288 3320", rating=4.3, since="2021")
        suppliers = [gulf_fresh, al_rawabi, kdd, prime_meats, green_valley, sparkle, estate_linens, al_manar,
                     aquacare, brightline]
        for s in suppliers:
            db.add(s)
        await db.flush()

        food_defs = [
            ("Hammour Fillet", "Seafood", 6.4, "kg", D(2), "Walk-in Freezer", gulf_fresh, 9.8),
            ("Basmati Rice", "Dry Goods", 38, "kg", D(210), "Dry Store", al_rawabi, 1.1),
            ("Fresh Milk", "Dairy", 12, "L", D(3), "Kitchen Fridge", kdd, 0.6),
            ("Mixed Berries (frozen)", "Frozen", 9, "kg", D(90), "Walk-in Freezer", gulf_fresh, 4.4),
            ("Beef Tenderloin", "Meat", 3.2, "kg", D(1), "Walk-in Chiller", prime_meats, 14.5),
            ("Halloumi Cheese", "Dairy", 4, "kg", D(20), "Kitchen Fridge", kdd, 5.2),
            ("Saffron", "Dry Goods", 80, "g", D(400), "Spice Cabinet", al_rawabi, 3.5),
            ("Bell Peppers", "Vegetables", 5, "kg", D(-1), "Kitchen Fridge", green_valley, 1.3),
            ("Onion", "Vegetables", 4000, "g", D(10), "Kitchen Fridge", green_valley, 0.0004),
            ("Ghee", "Dairy", 3000, "ml", D(180), "Dry Store", kdd, 0.0035),
            ("Zucchini", "Vegetables", 3000, "g", D(5), "Kitchen Fridge", green_valley, 0.0009),
            ("Olive oil", "Dry Goods", 5000, "ml", D(200), "Dry Store", al_rawabi, 0.0045),
            ("Lemon", "Vegetables", 40, "units", D(10), "Kitchen Fridge", green_valley, 0.15),
            ("Brioche", "Bakery", 24, "units", D(4), "Dry Store", al_rawabi, 0.25),
            ("Eggs", "Dairy", 120, "units", D(14), "Kitchen Fridge", kdd, 0.08),
            ("Sugar", "Dry Goods", 10000, "g", D(365), "Dry Store", al_rawabi, 0.0006),
            ("Puff pastry", "Frozen", 3000, "g", D(90), "Walk-in Freezer", al_rawabi, 0.006),
            ("Mushroom duxelles", "Vegetables", 2000, "g", D(5), "Kitchen Fridge", green_valley, 0.003),
            ("Prosciutto", "Meat", 1000, "g", D(15), "Walk-in Chiller", prime_meats, 0.012),
            ("Egg wash", "Dairy", 20, "units", D(7), "Kitchen Fridge", kdd, 0.08),
            ("Red lentils", "Dry Goods", 8000, "g", D(300), "Dry Store", al_rawabi, 0.0009),
            ("Cumin", "Dry Goods", 500, "g", D(400), "Spice Cabinet", al_rawabi, 0.012),
            ("Carrot", "Vegetables", 3000, "g", D(10), "Kitchen Fridge", green_valley, 0.0004),
            ("Vegetable stock", "Dry Goods", 20, "L", D(60), "Dry Store", al_rawabi, 0.3),
        ]
        food_inventory: dict[str, FoodInventory] = {}
        for name, category, qty, unit, expiry, location, supplier, cost in food_defs:
            f = FoodInventory(name=name, category=category, qty=qty, unit=unit, batch=f"B-{len(food_inventory)+1:04d}",
                               expiry=expiry, location=location, supplier_id=supplier.id, cost=cost)
            db.add(f)
            await db.flush()
            food_inventory[name] = f

        # Every ingredient links to a real food_inventory row (name, unit and
        # cost are never stored on the ingredient itself — see
        # RecipeIngredient's docstring). Where a recipe's natural unit
        # differs from how the item is stocked (e.g. grams vs. a kg-tracked
        # item), the third tuple element names the override unit; None means
        # "same unit the item is stocked in".
        recipe_defs = [
            ("Saffron Rice with Grilled Hammour", "Dinner", ["Fish"], 8, 2600, 380, [
                ("Hammour Fillet", 1.2, None), ("Basmati Rice", 900, "g"),
                ("Saffron", 2, None), ("Onion", 300, None), ("Ghee", 120, None),
            ]),
            ("Roasted Vegetable & Halloumi Salad", "Lunch", ["Dairy"], 12, 980, 210, [
                ("Halloumi Cheese", 250, "g"), ("Zucchini", 300, None),
                ("Bell Peppers", 250, "g"), ("Olive oil", 60, None), ("Lemon", 2, None),
            ]),
            ("French Toast with Berry Compote", "Breakfast", ["Gluten", "Eggs", "Dairy"], 5, 1080, 255, [
                ("Brioche", 8, None), ("Eggs", 4, None), ("Fresh Milk", 200, "ml"),
                ("Mixed Berries (frozen)", 300, "g"), ("Sugar", 60, None),
            ]),
            ("Classic Beef Wellington", "Special Meals", ["Gluten", "Eggs"], 10, 2700, 300, [
                ("Beef Tenderloin", 1.5, None), ("Puff pastry", 600, None),
                ("Mushroom duxelles", 400, None), ("Prosciutto", 150, None), ("Egg wash", 1, None),
            ]),
            ("Lentil & Cumin Soup", "Lunch", [], 5, 2108, 330, [
                ("Red lentils", 400, None), ("Cumin", 8, None),
                ("Carrot", 200, None), ("Vegetable stock", 1.5, None),
            ]),
        ]
        uom_by_label = {u.label: u for u in (await db.execute(select(UnitOfMeasure))).scalars().all()}
        recipes: dict[str, Recipe] = {}
        for name, category, allergens, loss, raw_yield, portion, ingredients in recipe_defs:
            recipe = Recipe(name=name, category=category, allergens=allergens, prep_loss_pct=loss,
                             raw_yield_g=raw_yield, portion_size_g=portion, cooking_method=category,
                             method=f"Prepare {name.lower()} following standard kitchen method.")
            db.add(recipe)
            await db.flush()
            for food_name, qty, override_unit_label in ingredients:
                override_unit = uom_by_label.get(override_unit_label) if override_unit_label else None
                db.add(RecipeIngredient(
                    recipe_id=recipe.id, food_inventory_id=food_inventory[food_name].id, qty=qty,
                    override_unit_id=override_unit.id if override_unit else None,
                ))
            recipes[name] = recipe

        stock_by_id = {f.id: f for f in food_inventory.values()}
        meal_defs = [
            (D(0), "Staff Meals", "Lentil & Cumin Soup", "Lentil & Cumin Soup", 9),
            (D(0), "Gastro", "Saffron Rice with Grilled Hammour", "Saffron Rice with Grilled Hammour", 4),
            (D(-1), "À la Carte", "Roasted Vegetable & Halloumi Salad", "Roasted Vegetable & Halloumi Salad", 2),
            (D(-2), "Traiteurs", "Classic Beef Wellington", "Classic Beef Wellington", 6),
            (D(-3), "Gastro", "French Toast with Berry Compote", "French Toast with Berry Compote", 4),
        ]
        for meal_date, category, dish, recipe_name, qty in meal_defs:
            recipe = recipes[recipe_name]
            ingredients = (await db.execute(
                select(RecipeIngredient).where(RecipeIngredient.recipe_id == recipe.id)
            )).scalars().all()
            # Reuses the same live-costing logic the API uses (see
            # app/api/v1/kitchen.py) rather than re-deriving it here, so this
            # can't drift from how real meal logging actually computes cost.
            stock_unit_labels = {stock_by_id[i.food_inventory_id].unit for i in ingredients if i.food_inventory_id in stock_by_id}
            override_ids = {i.override_unit_id for i in ingredients if i.override_unit_id}
            uom_by_label2, uom_by_id2 = await _load_uom_map(db, stock_unit_labels, override_ids)
            resolved = []
            for i in ingredients:
                stock = stock_by_id.get(i.food_inventory_id)
                qty_conv, _ = _resolve_ingredient_qty(i, stock, uom_by_label2, uom_by_id2)
                resolved.append((qty_conv, float(stock.cost) if stock else 0.0, float(i.yield_pct)))
            unit_cost = compute_recipe_cost(recipe, resolved).cost_per_portion
            db.add(MealLog(date=meal_date, category=category, dish=dish, recipe_id=recipe.id, qty=qty,
                            unit_cost=unit_cost, logged_by=staff_users["stf-2"].id, notes=""))

        db.add(ProposedMenu(occasion="Tomorrow's Lunch", occasion_type="Lunch", for_date=D(1), category="Gastro",
                             created_by=staff_users["stf-2"].id, status="Proposed", notes="Owner to confirm main dish."))
        proposal = (await db.execute(
            select(ProposedMenu).where(ProposedMenu.occasion == "Tomorrow's Lunch")
        )).scalar_one()
        db.add(MenuOption(proposed_menu_id=proposal.id, recipe_id=recipes["Saffron Rice with Grilled Hammour"].id,
                           note="Main option", selected=False))
        db.add(MenuOption(proposed_menu_id=proposal.id, recipe_id=recipes["Roasted Vegetable & Halloumi Salad"].id,
                           note="Lighter alternative", selected=False))

        # ------------------------------------------------------ inventory --
        inv_defs = [
            ("All-Purpose Cleaner", "Cleaning Chemicals", "CLN-001", "bottle", 8, 12, 40, "Housekeeping Store", sparkle, 1.9, 1.85, D(400)),
            ("Bath Towels (Set of 2)", "Linen", "LIN-014", "set", 22, 10, 40, "Linen Room", estate_linens, 8.5, 8.2, None),
            ("Toilet Paper (12-pack)", "Toiletries", "TLT-004", "pack", 5, 8, 25, "Housekeeping Store", sparkle, 3.4, 3.3, None),
            ("Wine Glasses (Crystal)", "Glassware", "GLS-009", "unit", 34, 24, 60, "Dining Cabinet", al_manar, 6.2, 6.0, None),
            ("Pool Chlorine Tablets", "Pool Supplies", "PL-002", "kg", 6, 10, 30, "Pool Storage", aquacare, 4.1, 4.0, D(500)),
            ("Garden Fertilizer (NPK)", "Garden Supplies", "GD-006", "bag", 14, 6, 20, "Garden Shed", green_valley, 5.5, 5.4, D(600)),
            ("LED Bulb (Warm White)", "Electrical Items", "EL-021", "unit", 9, 15, 40, "Maintenance Store", brightline, 1.6, 1.5, None),
            ("A4 Printer Paper", "Stationery", "ST-002", "ream", 3, 5, 15, "Office", al_manar, 2.1, 2.0, None),
        ]
        inventory: dict[str, Inventory] = {}
        for name, category, sku, unit, stock, min_, max_, location, supplier, last_price, avg_price, expiry in inv_defs:
            item = Inventory(name=name, category=category, sku=sku, unit=unit, stock=stock, min=min_, max=max_,
                              location=location, supplier_id=supplier.id, last_price=last_price, avg_price=avg_price,
                              expiry=expiry, batch=f"IV-{len(inventory)+1:04d}")
            db.add(item)
            await db.flush()
            inventory[name] = item

        # item master: mirrors the prototype's buildItemMaster() — one row
        # per stock record, pointing back at it via stock_type/stock_id.
        item_master: dict[str, ItemMaster] = {}
        for name, f in food_inventory.items():
            im = ItemMaster(name=name, code=f"FD-{len(item_master)+1:03d}", uom=f.unit, last_price=float(f.cost),
                             preferred_supplier_id=f.supplier_id, min_stock=round(float(f.qty) * 0.3, 2),
                             reorder_level=round(float(f.qty) * 0.5, 2), stock_type="food", stock_id=f.id)
            db.add(im)
            await db.flush()
            item_master[name] = im
        for name, i in inventory.items():
            im = ItemMaster(name=name, code=i.sku, uom=i.unit, last_price=float(i.last_price),
                             preferred_supplier_id=i.supplier_id, min_stock=float(i.min),
                             reorder_level=round((float(i.min) + float(i.max)) / 2, 2),
                             stock_type="general", stock_id=i.id)
            db.add(im)
            await db.flush()
            item_master[name] = im

        # -------------------------------------------------- purchase chain --
        pr1 = PurchaseRequest(item="Toilet Paper (12-pack)", qty=15, unit="pack", category="Toiletries",
                               requested_by=staff_users["stf-3"].id, request_date=D(-1), status="Pending Approval",
                               urgency="High", est_cost=51, linked_inventory_id=item_master["Toilet Paper (12-pack)"].id)
        pr2 = PurchaseRequest(item="Pool Chlorine Tablets", qty=20, unit="kg", category="Pool Supplies",
                               requested_by=staff_users["stf-8"].id, request_date=D(-2), status="Pending Approval",
                               urgency="High", est_cost=82, linked_inventory_id=item_master["Pool Chlorine Tablets"].id)
        db.add_all([pr1, pr2])

        po1 = PurchaseOrder(code="PO-1042", supplier_id=sparkle.id, status="Goods Received", order_date=D(-8),
                             expected_date=D(-3), total=72.5, payment_status="Paid")
        db.add(po1)
        await db.flush()
        line1 = PoLine(po_id=po1.id, item_master_id=item_master["All-Purpose Cleaner"].id,
                        name="All-Purpose Cleaner", qty=20, unit="bottle", price=1.9, last_price=1.75, received_qty=20)
        db.add(line1)
        await db.flush()
        grn1 = Grn(code="GRN-2001", po_id=po1.id, supplier_id=sparkle.id, date=D(-3), received_by=staff_users["stf-3"].id)
        db.add(grn1)
        await db.flush()
        db.add(GrnLine(grn_id=grn1.id, po_line_id=line1.id, name="All-Purpose Cleaner", ordered_qty=20,
                        received_qty=20, unit="bottle", ordered_price=1.9, price=1.9))

        po2 = PurchaseOrder(code="PO-1046", supplier_id=aquacare.id, status="Pending Approval", order_date=D(0),
                             expected_date=D(4), total=82, payment_status="Unpaid")
        db.add(po2)
        await db.flush()
        db.add(PoLine(po_id=po2.id, item_master_id=item_master["Pool Chlorine Tablets"].id,
                       name="Pool Chlorine Tablets", qty=20, unit="kg", price=4.1, last_price=3.9, received_qty=0))

        # ---------------------------------------------------------- assets --
        asset_defs = [
            ("Central AC Unit — Majlis", "AC Units", "Daikin", "VRV-IV", "Majlis", D(220), D(-40), D(20), aquacare, 4200, "stf-9"),
            ("Backup Generator", "Generators", "Cummins", "C150D5", "Utility Yard", D(-100), D(-75), D(15), brightline, 6800, "stf-9"),
            ("Sub-Zero Refrigerator", "Refrigerators", "Sub-Zero", "BI-48S", "Main Kitchen", D(150), D(-30), D(60), al_manar, 9200, "stf-2"),
            ("Washing Machine — Laundry", "Washing Machines", "Miele", "W1 Classic", "Laundry Room", D(60), D(-100), D(-10), al_manar, 2100, "stf-3"),
            ("Pool Filtration Pump", "Pool Equipment", "Pentair", "IntelliFlo", "Pool Plant Room", D(-200), D(-20), D(40), aquacare, 1850, "stf-9"),
        ]
        for name, category, brand, model, location, warranty_end, last_service, next_service, supplier, cost, assignee in asset_defs:
            db.add(Asset(name=name, category=category, brand=brand, model=model,
                          location_id=areas.get(location).id if location in areas else None,
                          warranty_end=warranty_end, last_service=last_service, next_service=next_service,
                          provider=supplier.name, supplier_id=supplier.id, purchase_cost=cost, status="Active",
                          assigned_to=staff[assignee].id, approval_status="Approved", created_by=owner_user.id))
        await db.flush()
        asset_result = (await db.execute(select(Asset))).scalars().all()
        asset_by_name = {a.name: a for a in asset_result}
        db.add(PmSchedule(asset_id=asset_by_name["Pool Filtration Pump"].id, task="Pump pressure & seal inspection",
                           frequency="Quarterly", due_date=D(-2)))
        db.add(PmSchedule(asset_id=asset_by_name["Central AC Unit — Majlis"].id, task="Filter clean & gas check",
                           frequency="Quarterly", due_date=D(20)))

        db.add(MaintenanceRequest(issue="Leaking tap", location_id=areas["Guest Room 2"].id,
                                   description="Constant drip from hot water tap.", priority="High",
                                   reported_by=staff_users["stf-4"].id, reported_date=D(0), status="In Progress",
                                   assignee_id=staff["stf-9"].id))
        db.add(MaintenanceRequest(issue="AC not cooling", location_id=areas["Guest Room 3"].id,
                                   description="AC running but room not cooling below 26°C.", priority="High",
                                   reported_by=staff_users["stf-5"].id, reported_date=D(-1), status="Assigned",
                                   assignee_id=staff["stf-9"].id))

        # -------------------------------------------------------- vehicles --
        v1 = Vehicle(name="Toyota Land Cruiser", reg="KWT 44821", driver_id=staff["stf-6"].id, mileage=38200,
                      insurance_expiry=D(45), reg_expiry=D(120), last_service=D(-70), next_service=D(20),
                      tyre_status="Good", battery="Replaced", fuel_type="Petrol", color="Pearl White")
        v2 = Vehicle(name="Lexus LX", reg="KWT 91203", driver_id=staff["stf-7"].id, mileage=21500,
                      insurance_expiry=D(10), reg_expiry=D(300), last_service=D(-30), next_service=D(60),
                      tyre_status="Good", battery="Good", fuel_type="Petrol", color="Black")
        db.add_all([v1, v2])
        await db.flush()
        db.add(VehicleHistory(vehicle_id=v1.id, date=D(-70), type="Service", description="Oil change, filter replacement", cost=65))
        db.add(VehicleHistory(vehicle_id=v2.id, date=D(-30), type="Service", description="Routine service + tyre rotation", cost=85))

        # --------------------------------------------------- guests/events --
        db.add(Guest(name="The Hendricks Family", arrival=D(1), departure=D(4), count=4, room="Guest Room 1 & 2",
                      dietary="One vegetarian", requests="Airport pickup required.", driver_id=staff["stf-6"].id,
                      notes="Longtime family friends."))
        db.add(Guest(name="Dr. Amina Farouk", arrival=D(2), departure=D(3), count=1, room="Guest Room 3",
                      dietary="No restrictions", requests="Quiet room, early breakfast.", driver_id=staff["stf-7"].id))

        db.add(Event(name="Family Birthday Celebration", type="Birthday", date=D(6), location="Terrace & Dining Room",
                      guests_count=18, menu="Beef Wellington, birthday cake, canapés",
                      shopping="Cake ingredients, decorations, balloons",
                      staff_needed=[str(staff["stf-2"].id), str(staff["stf-3"].id)],
                      cleaning="Terrace deep clean, dining room setup", maintenance="Check terrace lighting",
                      notes="Theme: navy & gold.", tasks_generated=True))
        db.add(Event(name="Anniversary Dinner Party", type="Dinner Party", date=D(20), location="Private Dining Room",
                      guests_count=10, menu="5-course tasting menu (TBC)", shopping="Wine pairing, floral arrangements",
                      staff_needed=[str(staff["stf-2"].id)], cleaning="Private dining room", maintenance="Dimmer switch check",
                      notes="Anniversary — coordinate discreetly.", tasks_generated=False))

        # ------------------------------------------------------- expenses --
        expense_defs = [
            ("Food", 145, D(0), "Gulf Fresh Seafood", "Card", "Weekly seafood order"),
            ("Staff", 3940, D(-2), "Payroll", "Bank Transfer", "Monthly salaries"),
            ("Maintenance", 210, D(-15), "Gulf Cooling Services", "Card", "AC service — Majlis"),
            ("Vehicles", 85, D(-30), "Al-Futtaim Service Center", "Card", "Lexus LX routine service"),
            ("Utilities", 610, D(-5), "MEW Kuwait", "Bank Transfer", "Electricity & water"),
            ("Garden", 96, D(-12), "Green Valley Produce", "Cash", "Fertilizer & plants"),
        ]
        for category, amount, exp_date, supplier, method, notes in expense_defs:
            db.add(Expense(category=category, amount=amount, date=exp_date, supplier=supplier, method=method,
                            notes=notes, created_by=owner_user.id))

        # ------------------------------------------------------ documents --
        doc_defs = [
            ("Ramon Villanueva — Employment Contract", "Staff Contracts", "Ramon Villanueva", D(-500), D(210)),
            ("Yusuf Demir — Kuwait Civil ID", "IDs", "Yusuf Demir", D(-200), D(75)),
            ("Wilson Mbeki — Residency Permit", "IDs", "Wilson Mbeki", D(-300), D(9)),
            ("Property Title Deed", "Property Documents", "Residence", D(-2800), None),
            ("Sub-Zero Refrigerator — Warranty", "Equipment Warranties", "Sub-Zero Refrigerator", D(-500), D(150)),
        ]
        for name, category, linked, upload_date, expiry in doc_defs:
            db.add(Document(name=name, category=category, linked_to=linked, upload_date=upload_date, expiry=expiry))

        # ---------------------------------------------------------- tasks --
        task_defs = [
            ("Clean master bedroom & en-suite", "Housekeeping", "stf-3", "Master Bedroom", "High", D(0), "In Progress"),
            ("Prepare lunch menu for family", "Kitchen", "stf-2", "Main Kitchen", "High", D(0), "Completed"),
            ("Vacuum & mop living room", "Housekeeping", "stf-4", "Living Room", "Medium", D(0), "Pending"),
            ("Repair leaking guest bathroom tap", "Maintenance", "stf-9", "Guest Room 2", "High", D(0), "In Progress"),
            ("Weekly vehicle wash — Land Cruiser", "Vehicles", "stf-6", "Garage", "Medium", D(0), "Pending"),
            ("Change linen — all guest rooms", "Housekeeping", "stf-5", "Guest Rooms", "Medium", D(-1), "Overdue"),
        ]
        for title, category, assignee, location, priority, due, status in task_defs:
            task = Task(title=title, category=category, assignee_id=staff[assignee].id,
                        location_id=areas.get(location).id if location in areas else None,
                        priority=priority, due_date=due, recurrence="Daily", status=status,
                        verified=status == "Verified")
            db.add(task)
            await db.flush()
            db.add(TaskChecklistItem(task_id=task.id, text="Complete task", done=status in ("Completed", "Verified")))

        db.add(TaskTemplate(title="Master bedroom clean", category="Housekeeping", recurrence="Daily",
                             items=["Dusting", "Vacuuming", "Mopping", "Change linen"]))

        db.add(GardenTask(title="Irrigation system check", zone="Front Garden", frequency="Weekly",
                           last_done=D(-2), next_due=D(5), assignee_id=staff["stf-8"].id))
        db.add(PoolLog(date=D(0), ph=7.4, chlorine=2.0, temp=29, filter_cleaned=True, notes="All readings within range."))

        db.add(ActivityLog(actor_id=owner_user.id, actor_name=owner_user.name, role_label="Owner / Admin",
                            action="Seeded database", detail="Initial local dev data load"))

        await db.commit()
        print(f"Seed complete. Dev login password for every seeded user: '{DEV_PASSWORD}'")
        print(f"Owner login: {owner_user.email}")


if __name__ == "__main__":
    asyncio.run(seed())

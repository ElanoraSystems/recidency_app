# Hadlaan Residence — Full-Stack App

A real full-stack implementation of the Hadlaan Residence management prototype,
built per the Hadlaan Build Plan: **React 18 + TypeScript** frontend, **FastAPI +
PostgreSQL** backend, JWT auth with server-enforced RBAC, and the real
PR → PO → GRN and meal-consumption business logic (not just UI mockups).

## Stack

- **Backend**: FastAPI, Python 3.11, SQLAlchemy 2.0 (async) + Alembic, PostgreSQL
- **Frontend**: React 18 + TypeScript, Vite, Tailwind CSS v4, TanStack Query, React Router
- **Local DB**: PostgreSQL via Docker Compose
- **File storage**: local disk in dev (`backend/uploads/`), designed to swap for
  S3 presigned URLs in production (see the build plan, §05)

## Prerequisites

- Docker Desktop (for Postgres)
- Python 3.11 (`brew install python@3.11` if you don't have it — 3.12+ system
  Python is fine too, this repo's venv was built against 3.11)
- Node 20+

## First-time setup

```bash
# 1. Start Postgres (mapped to host port 5433 — this machine already had a
#    native Homebrew Postgres bound to 5432, so we moved off it to avoid a conflict)
docker compose up -d db

# 2. Backend: create venv, install deps, migrate, seed
cd backend
python3.11 -m venv venv
./venv/bin/pip install -r requirements.txt
cp .env.example .env   # already done in this checkout; edit if you change ports
./venv/bin/alembic upgrade head
./venv/bin/python -m app.seed

# 3. Frontend
cd ../frontend
npm install
```

## Running it

```bash
# Terminal 1 — backend (from backend/)
./venv/bin/uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend (from frontend/)
npm run dev
```

Open **http://localhost:5173**. The Vite dev server proxies `/api` to
`localhost:8000`, so no CORS config is needed in dev.

## Logging in

Every seeded user shares the dev password **`password123`**. A few to try:

| Email | Role |
|---|---|
| `owner@hadlaan.local` | Owner — full access |
| `ramon.v@residence.local` | Residence Manager |
| `aiko.t@residence.local` | Chef — kitchen, inventory, purchasing, tasks only |
| `maria.s@residence.local` | Housekeeper |
| `spouse@hadlaan.local` | Family login (dashboard, kitchen, guests, events, documents, expenses) |

Role → module access is **data, not code** (`role_module_access` /
`family_module_access` tables), editable from the Settings page as the Owner —
and it's enforced server-side on every request via `require_module()`, not
just hidden in the UI like the original prototype.

## What's implemented

Following the build plan's phase order (§07):

- **Phase 0 — Foundations**: real Postgres schema (46 tables), Alembic
  migrations, JWT auth (access + refresh), server-enforced RBAC.
- **Phase 1 — People & residence setup**: staff (creates a `users` + linked
  `staff_profiles` row), attendance, leave requests, housekeeping areas, tasks.
- **Phase 2 — Kitchen & purchasing** *(highest-risk phase per the plan)*:
  recipe costing engine (prep-loss-adjusted yield/portion cost), meal logging
  that **atomically deducts recipe ingredients from food inventory in the same
  transaction**, item master, and the full **PR → PO → GRN chain** — receiving
  a GRN atomically updates the PO's received quantities, marks it
  Ordered/Partially Received/Goods Received, and increments the linked stock
  record. Both verified against a running Postgres instance, not just read.
- **Phase 3 — Assets & maintenance**: assets with the approval gate (a
  non-owner's new asset sits `Pending` until approved), maintenance requests,
  PM schedule, vehicles.
- **Phase 4 — Guests, events, documents**: guest/event records, expenses,
  documents with file upload (local-disk today; the code is structured so
  swapping in boto3 presigned S3 URLs per §05 only touches
  `document_files.py`).
- **Phase 5 — Approvals & activity log**: a real unified Approvals inbox
  (queries across PRs, POs, menu proposals, assets, leave) with
  approve/reject actions, a full activity log, and Owner-managed family
  logins with per-module access.

## What's not built yet

- **Phase 6 (Mobile)** and **Phase 7 (Hardening)** from the build plan —
  no PWA manifest, no production S3 wiring, no Sentry, no automated tests.
- A handful of simpler modules (Housekeeping, Inventory, Maintenance,
  Vehicles, Garden & Pool, Guests, Events, Expenses, Documents) use a shared
  generic list+create UI rather than a bespoke screen per module — the API
  underneath is real and full-featured (edit/delete included), the frontend
  for those is intentionally minimal so the effort went into the
  interlocking business logic instead.
- Proposed-menu approval and asset-approval decisions exist as API endpoints
  (used by the Approvals inbox) but don't yet have dedicated detail views.

## Project layout

```
backend/
  app/
    models/       SQLAlchemy models, grouped by domain (people, kitchen, purchasing, ...)
    schemas/       few shared Pydantic schemas (most live inline in api/v1/*.py)
    crud/generic.py   introspection-based CRUD router factory for simple tables
    api/v1/        one router per domain; kitchen.py / purchasing.py / facilities.py /
                    people.py / tasks.py / approvals.py hold the real business logic
    seed.py         local dev seed data mirroring the reference prototype
  alembic/          migrations
docker-compose.yml  Postgres only, mapped to host port 5433
frontend/
  src/
    api/            axios client (JWT + refresh interceptor) + TanStack Query hooks
    auth/           AuthContext
    layout/         rail-nav shell matching the prototype's visual identity
    pages/          Dashboard, Login, People, Kitchen, Purchasing, Tasks, Approvals,
                    Reports, Settings, + SimplePages.tsx for the generic-CRUD modules
    components/     shared UI primitives + SimpleListPage (generic list/create screen)
```

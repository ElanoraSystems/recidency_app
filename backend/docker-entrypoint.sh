#!/bin/sh
# Runs pending migrations before every boot so a deploy can never serve
# traffic against a stale schema — if alembic fails, `set -e` stops the
# container before uvicorn ever starts (fail closed, not open).
set -e
alembic upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8010}"

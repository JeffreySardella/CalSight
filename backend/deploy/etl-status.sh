#!/bin/bash
# Quick check of ETL pipeline status.
# Run from the repo root on the deploy host (LXC 100): bash backend/deploy/etl-status.sh
#
# Shows: last 10 runs and any failures in the last 7 days.
#
# The backend runs under Docker Compose v2, whose default container name is
# derived from the project + service (not a fixed `calsight-backend`), so we
# address it through `docker compose ... exec backend` — matching the deploy
# workflow and backend/deploy/README.md — rather than `docker exec <name>`.
# Override the compose file location with COMPOSE_FILE if not run from the root.

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
COMPOSE=(docker compose -f "$COMPOSE_FILE")

echo "=== Last 10 ETL Runs ==="
"${COMPOSE[@]}" exec -T backend python -c "
from app.database import SessionLocal
from app.models import EtlRun
db = SessionLocal()
runs = db.query(EtlRun).order_by(EtlRun.started_at.desc()).limit(10).all()
for r in runs:
    status_icon = '✓' if r.status == 'success' else '✗' if r.status == 'error' else '⊘'
    elapsed = ''
    if r.finished_at and r.started_at:
        secs = (r.finished_at - r.started_at).total_seconds()
        elapsed = f' ({secs:.0f}s)'
    trigger = f' [{r.triggered_by}]' if r.triggered_by else ''
    print(f'  {status_icon} {r.source:<25s} {r.status:<10s} {r.started_at:%Y-%m-%d %H:%M}{elapsed}{trigger}')
db.close()
"

echo ""
echo "=== Failures (last 7 days) ==="
"${COMPOSE[@]}" exec -T backend python -c "
from datetime import datetime, timedelta, timezone
from app.database import SessionLocal
from app.models import EtlRun
db = SessionLocal()
# naive UTC, matching EtlRun columns (datetime.utcnow is deprecated)
cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=7)
fails = db.query(EtlRun).filter(EtlRun.status == 'error', EtlRun.started_at >= cutoff).all()
if not fails:
    print('  None')
else:
    for r in fails:
        msg = (r.error_message or '')[:100]
        print(f'  {r.source} @ {r.started_at:%Y-%m-%d %H:%M}: {msg}')
db.close()
"

# NOTE: scheduling is no longer a host crontab. The `pipeline` compose service
# (APScheduler in python -m etl.pipeline) owns the cron schedules — see
# docker-compose.pipeline.yml and backend/etl/pipeline.py. Inspect it with:
#   docker compose -f docker-compose.pipeline.yml logs pipeline

#!/bin/bash
# Quick check of ETL pipeline status.
# Run on LXC 100: bash etl-status.sh
#
# Shows: last 10 runs, any failures, next scheduled run

CONTAINER_NAME="calsight-backend"

echo "=== Last 10 ETL Runs ==="
docker exec "$CONTAINER_NAME" python -c "
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
docker exec "$CONTAINER_NAME" python -c "
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

echo ""
echo "=== Cron Schedule ==="
crontab -l 2>/dev/null | grep etl || echo "  No ETL cron job found"

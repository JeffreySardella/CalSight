#!/bin/bash
# Run this on LXC 100 to set up the ETL scheduler.
# It adds a cron job that runs the orchestrator weekly (Sunday 2 AM).
#
# Usage: bash setup-etl-cron.sh

set -e

CONTAINER_NAME="calsight-backend"
CRON_SCHEDULE="0 2 * * 0"
LOG_DIR="/var/log/calsight"

mkdir -p "$LOG_DIR"

# Remove old cron entry if exists
crontab -l 2>/dev/null | grep -v "etl.run_all" | crontab - 2>/dev/null || true

# Add new cron entry
(crontab -l 2>/dev/null; echo "$CRON_SCHEDULE docker exec $CONTAINER_NAME python -m etl.run_all --triggered-by schedule >> $LOG_DIR/etl.log 2>&1") | crontab -

echo "ETL cron job installed:"
crontab -l | grep etl
echo ""
echo "Logs will be written to: $LOG_DIR/etl.log"
echo "Check status: docker exec $CONTAINER_NAME python -c \"from app.database import SessionLocal; from app.models import EtlRun; db=SessionLocal(); runs=db.query(EtlRun).order_by(EtlRun.started_at.desc()).limit(5).all(); [print(f'{r.source}: {r.status} ({r.started_at})') for r in runs]\""

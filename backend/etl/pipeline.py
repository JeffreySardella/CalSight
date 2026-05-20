"""Automated Data Pipeline — Production-grade ETL scheduling and monitoring.

This module ties together the existing orchestrator, scheduler, and jobs
into a fully automated pipeline with:

  1. Multi-tier scheduling (daily crash data, monthly reference data)
  2. Incremental ETL with freshness checks
  3. Materialized view refresh (CONCURRENTLY for zero downtime)
  4. Monitoring and alerting (webhook notifications on failure)
  5. Database maintenance (VACUUM/ANALYZE after loads)
  6. Backup scheduling (pg_dump with rotation)
  7. Data validation gates (row count, null spike detection)

Architecture:
  - Runs as a separate Docker service alongside the API
  - Uses APScheduler with CronTrigger for time-based scheduling
  - Sends alerts via webhook (Discord/Slack) on failures
  - Logs all runs to the etl_runs table for the /api/etl/status endpoint

Usage:
    python -m etl.pipeline                    # Start with defaults
    python -m etl.pipeline --no-backup        # Skip pg_dump scheduling
    python -m etl.pipeline --alert-test       # Send a test alert and exit
"""

from __future__ import annotations

import argparse
import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_EXECUTED
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from etl.alerts import send_alert, AlertLevel
from etl.jobs import build_default_registry
from etl.orchestrator import run_pipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Schedule Configuration
# ---------------------------------------------------------------------------
# All cron times in UTC to avoid container timezone confusion.
# Prod container (LXC 100) may lack tzdata, so explicit UTC is safest.
# Pacific = UTC-7 (PDT summer) / UTC-8 (PST winter).

ETL_TIMEZONE = "UTC"

SCHEDULES = {
    # Daily crash data refresh — CHP updates the CCRS CKAN dataset overnight
    "daily_crashes": {
        "cron": "0 11 * * *",  # 11 AM UTC = 4 AM Pacific (PDT)
        "jobs": None,  # None = all non-static jobs (respects dependency order)
        "description": "Full daily pipeline: crashes, parties, victims, backfill, matviews",
    },
    # Weekly full refresh — includes monthly sources that might have updated
    "weekly_full": {
        "cron": "0 9 * * 0",  # 9 AM UTC = 2 AM Pacific (PDT), Sunday
        "jobs": None,
        "force_refresh": True,
        "description": "Weekly forced refresh of all sources",
    },
    # Database maintenance — VACUUM ANALYZE after the daily load finishes
    "maintenance": {
        "cron": "0 15 * * *",  # 3 PM UTC = 8 AM Pacific (after daily ETL settles)
        "jobs": ["vacuum"],
        "description": "VACUUM ANALYZE on hot tables and matviews",
    },
    # Backup — pg_dump nightly
    "backup": {
        "cron": "0 7 * * *",  # 7 AM UTC = midnight Pacific (low traffic)
        "description": "PostgreSQL backup with 7-day rotation",
    },
}


# ---------------------------------------------------------------------------
# Pipeline execution functions
# ---------------------------------------------------------------------------

def run_daily_pipeline():
    """Execute the standard daily ETL pipeline."""
    logger.info("=" * 60)
    logger.info("  DAILY PIPELINE — Starting")
    logger.info("=" * 60)

    registry = build_default_registry()
    results = run_pipeline(registry, triggered_by="schedule")

    succeeded = sum(1 for r in results if r.status == "success")
    failed = sum(1 for r in results if r.status == "error")
    unchanged = sum(1 for r in results if r.status == "skipped_unchanged")
    skipped = sum(1 for r in results if r.status == "skipped")

    logger.info(
        "Daily pipeline complete: %d succeeded, %d failed, %d unchanged, %d skipped",
        succeeded, failed, unchanged, skipped,
    )

    # Alert on any failures
    if failed > 0:
        failed_names = [r.source for r in results if r.status == "error"]
        error_details = "\n".join(
            f"  - {r.source}: {(r.error_message or 'unknown')[:200]}"
            for r in results if r.status == "error"
        )
        send_alert(
            AlertLevel.ERROR,
            f"Daily ETL: {failed} job(s) failed",
            f"Failed jobs: {', '.join(failed_names)}\n\n{error_details}",
        )
    elif succeeded > 0:
        send_alert(
            AlertLevel.INFO,
            f"Daily ETL complete: {succeeded} succeeded, {unchanged} unchanged",
            "All jobs completed successfully.",
        )

    return results


def run_weekly_pipeline():
    """Execute a forced full refresh of all sources."""
    logger.info("=" * 60)
    logger.info("  WEEKLY FULL REFRESH — Starting")
    logger.info("=" * 60)

    registry = build_default_registry()
    results = run_pipeline(registry, triggered_by="schedule", force_refresh=True)

    failed = sum(1 for r in results if r.status == "error")

    if failed > 0:
        failed_names = [r.source for r in results if r.status == "error"]
        send_alert(
            AlertLevel.ERROR,
            f"Weekly refresh: {failed} job(s) failed",
            f"Failed: {', '.join(failed_names)}",
        )

    return results


def run_backup():
    """Run pg_dump with 7-day rotation.

    Backup strategy:
      - Daily pg_dump to /backups/calsight_YYYY-MM-DD.sql.gz
      - Keep 7 days of backups, delete older ones
      - Uses custom format (-Fc) for parallel restore capability
      - Excludes etl_runs (easily regenerated) to save space

    The backup directory is /backups inside the container, mounted as a
    Docker volume that maps to the host's /opt/calsight/backups on LXC 100.
    """
    backup_dir = Path(os.environ.get("BACKUP_DIR", "/backups"))
    backup_dir.mkdir(parents=True, exist_ok=True)

    today = datetime.utcnow().strftime("%Y-%m-%d")
    backup_file = backup_dir / f"calsight_{today}.dump"

    # Build pg_dump command from the ETL database URL
    db_url = os.environ.get("ETL_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
    if not db_url:
        logger.error("No DATABASE_URL configured — skipping backup")
        send_alert(AlertLevel.WARNING, "Backup skipped", "No DATABASE_URL configured")
        return

    logger.info("Starting backup: %s", backup_file)
    start = time.monotonic()

    try:
        result = subprocess.run(
            [
                "pg_dump",
                "--format=custom",
                "--compress=6",
                "--exclude-table=etl_runs",  # easily regenerated, saves space
                f"--file={backup_file}",
                db_url,
            ],
            capture_output=True,
            text=True,
            timeout=3600,  # 1 hour max
        )

        if result.returncode != 0:
            raise RuntimeError(f"pg_dump failed (exit {result.returncode}): {result.stderr[:500]}")

        elapsed = time.monotonic() - start
        size_mb = backup_file.stat().st_size / (1024 * 1024)
        logger.info("Backup complete: %.1f MB in %.0fs", size_mb, elapsed)

        # Rotate: delete backups older than 7 days
        cutoff = datetime.utcnow() - timedelta(days=7)
        removed = 0
        for old_file in backup_dir.glob("calsight_*.dump"):
            # Parse date from filename
            try:
                date_str = old_file.stem.replace("calsight_", "")
                file_date = datetime.strptime(date_str, "%Y-%m-%d")
                if file_date < cutoff:
                    old_file.unlink()
                    removed += 1
                    logger.info("Rotated old backup: %s", old_file.name)
            except ValueError:
                continue

        if removed:
            logger.info("Removed %d backup(s) older than 7 days", removed)

    except subprocess.TimeoutExpired:
        send_alert(AlertLevel.ERROR, "Backup timed out", "pg_dump exceeded 1 hour timeout")
        logger.error("Backup timed out after 1 hour")
    except Exception as exc:
        send_alert(AlertLevel.ERROR, "Backup failed", str(exc)[:500])
        logger.exception("Backup failed: %s", exc)


# ---------------------------------------------------------------------------
# Scheduler event listener
# ---------------------------------------------------------------------------

def _job_listener(event):
    """Log APScheduler job execution events."""
    job_id = event.job_id
    if event.exception:
        logger.error("Scheduled job %s raised: %s", job_id, event.exception)
    else:
        logger.info("Scheduled job %s completed successfully", job_id)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="CalSight Automated Data Pipeline")
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Disable backup scheduling (useful if pg_dump not available)",
    )
    parser.add_argument(
        "--alert-test",
        action="store_true",
        help="Send a test alert and exit",
    )
    parser.add_argument(
        "--run-now",
        choices=["daily", "weekly", "backup", "maintenance"],
        help="Run a specific pipeline immediately and exit",
    )
    args = parser.parse_args()

    if args.alert_test:
        send_alert(AlertLevel.INFO, "Pipeline alert test", "This is a test notification from the CalSight ETL pipeline.")
        print("Test alert sent. Check your webhook endpoint.")
        return 0

    if args.run_now:
        if args.run_now == "daily":
            run_daily_pipeline()
        elif args.run_now == "weekly":
            run_weekly_pipeline()
        elif args.run_now == "backup":
            run_backup()
        elif args.run_now == "maintenance":
            registry = build_default_registry()
            run_pipeline(registry, triggered_by="manual", only=["vacuum"])
        return 0

    # --- Pre-flight: ensure DB schema is up to date ---
    from etl.migrate import ensure_migrated
    if not ensure_migrated():
        logger.error("Schema migration failed — pipeline cannot start safely")
        return 1

    # --- Start the scheduler ---
    scheduler = BlockingScheduler()
    scheduler.add_listener(_job_listener, EVENT_JOB_EXECUTED | EVENT_JOB_ERROR)

    # Daily crash pipeline
    scheduler.add_job(
        run_daily_pipeline,
        CronTrigger.from_crontab(SCHEDULES["daily_crashes"]["cron"], timezone=ETL_TIMEZONE),
        id="daily_crashes",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    # Weekly full refresh
    scheduler.add_job(
        run_weekly_pipeline,
        CronTrigger.from_crontab(SCHEDULES["weekly_full"]["cron"], timezone=ETL_TIMEZONE),
        id="weekly_full",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    # Database maintenance
    scheduler.add_job(
        lambda: run_pipeline(
            build_default_registry(), triggered_by="schedule", only=["vacuum"]
        ),
        CronTrigger.from_crontab(SCHEDULES["maintenance"]["cron"], timezone=ETL_TIMEZONE),
        id="maintenance",
        replace_existing=True,
    )

    # Backup
    if not args.no_backup:
        scheduler.add_job(
            run_backup,
            CronTrigger.from_crontab(SCHEDULES["backup"]["cron"], timezone=ETL_TIMEZONE),
            id="backup",
            replace_existing=True,
        )

    logger.info("=" * 60)
    logger.info("  CalSight Automated Data Pipeline — Started")
    logger.info("=" * 60)
    logger.info("Schedules:")
    for name, config in SCHEDULES.items():
        if name == "backup" and args.no_backup:
            continue
        job = scheduler.get_job(name)
        next_run = job.next_run_time if job else "not scheduled"
        logger.info("  %-20s  cron=%-15s  next=%s", name, config["cron"], next_run)
    logger.info("=" * 60)

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Pipeline scheduler stopped")

    return 0


if __name__ == "__main__":
    sys.exit(main())

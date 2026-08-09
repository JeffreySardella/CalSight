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
import sys

from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_EXECUTED
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from etl.alerts import send_alert, send_heartbeat, AlertLevel, check_disk_and_alert
from etl.jobs import build_default_registry
from etl.orchestrator import run_pipeline

# Statuses that count as "we confirmed sync with upstream" — a successful load
# OR a verified-unchanged check. Mirrors app.routers.freshness._SYNC_STATUSES.
_SYNC_STATUSES = ("success", "skipped_unchanged")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def _init_sentry() -> None:
    """Sentry for the scheduler process (no-op unless SENTRY_DSN is set).

    The API initializes Sentry in app.main, but this process never imports
    it — so the 2026-07 startup crash-loop (an AttributeError before
    scheduler.start(), weeks of restarts) produced zero Sentry events.
    Mirrors app.main's config: send_default_pii stays False.
    """
    try:
        from app.settings import settings

        if not settings.sentry_dsn:
            return
        import sentry_sdk

        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.sentry_environment,
            traces_sample_rate=settings.sentry_traces_sample_rate,
            send_default_pii=False,
        )
        logger.info(
            "Sentry error monitoring enabled (environment=%s)",
            settings.sentry_environment,
        )
    except Exception as exc:
        # Monitoring must never stop the scheduler from starting.
        logger.warning("Sentry init failed (continuing without it): %s", exc)


# ---------------------------------------------------------------------------
# Schedule Configuration
# ---------------------------------------------------------------------------
# All cron times in UTC to avoid container timezone confusion.
# Prod container (LXC 100) may lack tzdata, so explicit UTC is safest.
# Pacific = UTC-7 (PDT summer) / UTC-8 (PST winter).

ETL_TIMEZONE = "UTC"

SCHEDULES = {
    # Day-of-week fields use NAMES, never numbers: APScheduler's CronTrigger
    # treats 0 as Monday (unlike standard crontab's 0=Sunday), so the numeric
    # "0" here silently ran the weekly on Mondays and skipped the daily every
    # Monday (caught live 2026-07-13). Names mean the same thing in both
    # conventions.
    #
    # Daily crash data refresh — CHP updates the CCRS CKAN dataset overnight
    # Mon-Sat only: Sunday is covered by weekly_full (which starts at 9 AM UTC),
    # so skipping daily on Sunday prevents the two pipelines from overlapping.
    "daily_crashes": {
        "cron": "0 11 * * mon-sat",  # 11 AM UTC = 4 AM Pacific (PDT), Mon-Sat only
        "jobs": None,  # None = all non-static jobs (respects dependency order)
        "description": "Full daily pipeline: crashes, parties, victims, backfill, matviews",
    },
    # Weekly full refresh — includes monthly sources that might have updated
    "weekly_full": {
        "cron": "0 9 * * sun",  # 9 AM UTC = 2 AM Pacific (PDT), Sunday
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

def _alert_validation_failures(results, pipeline_name: str) -> None:
    """Alert when any job's post-load validation failed (M6).

    The orchestrator records validation outcomes in etl_runs.validation_status
    but keeps the job status "success" (validation is non-blocking). Without
    this consumer, a >max_drop_pct row drop produced the "All jobs completed
    successfully" INFO alert. WARNING (not ERROR): the loads themselves
    finished — this is a data-quality signal, distinct from the ERROR alert
    for jobs that actually failed to run.
    """
    failed_validation = [
        r for r in results if getattr(r, "validation_status", None) == "failed"
    ]
    if not failed_validation:
        return

    names = [r.source for r in failed_validation]
    details = "\n".join(
        f"  - {r.source}: {(r.diff_summary or 'no details recorded')[:300]}"
        for r in failed_validation
    )
    send_alert(
        AlertLevel.WARNING,
        f"{pipeline_name}: validation FAILED for {len(failed_validation)} job(s)",
        f"Loads completed but post-load validation found critical problems "
        f"(e.g. a row-count drop beyond the allowed threshold).\n"
        f"Jobs: {', '.join(names)}\n\n{details}",
    )


def _fetch_last_sync_times() -> dict[str, object]:
    """Last confirmed-sync time per source from etl_runs (success OR unchanged).

    Separated out so the stale-source sweep can be tested without a database.
    """
    from sqlalchemy import func  # noqa: PLC0415

    from app.database import SessionLocal  # noqa: PLC0415
    from app.models import EtlRun  # noqa: PLC0415

    db = SessionLocal()
    try:
        rows = (
            db.query(EtlRun.source, func.max(EtlRun.finished_at))
            .filter(EtlRun.status.in_(_SYNC_STATUSES))
            .group_by(EtlRun.source)
            .all()
        )
        return {source: finished_at for source, finished_at in rows}
    finally:
        db.close()


def _alert_stale_sources(registry, pipeline_name: str) -> None:
    """Alert when a registered source hasn't confirmed sync within its threshold.

    Closes the 2026-07-17 gap: every monthly source (weather, demographics,
    unemployment, vehicles, calenviroscreen) sat ~2 months stale after the
    scheduler crash-loop, but is_stale lived only on the deprecated
    /api/freshness endpoint nobody reads, so no alert ever fired. This sweep
    runs the same shared thresholds after every pipeline. Best-effort: any
    failure here must never break the pipeline run.
    """
    try:
        from datetime import datetime, timezone  # noqa: PLC0415

        from app.freshness_logic import stale_sources  # noqa: PLC0415

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        last_sync = _fetch_last_sync_times()
        sources = set(registry.jobs.keys())
        stale = stale_sources(now, last_sync, sources)
        if not stale:
            return

        def _age(hours):
            if hours is None:
                return "never synced"
            days = hours / 24
            return f"{days:.0f}d since sync" if days >= 1 else f"{hours:.0f}h since sync"

        details = "\n".join(
            f"  - {source}: {_age(hours)} (threshold {threshold}h)"
            for source, hours, threshold in stale
        )
        send_alert(
            AlertLevel.WARNING,
            f"{pipeline_name}: {len(stale)} data source(s) stale",
            f"These sources haven't confirmed sync with upstream within their "
            f"staleness threshold — a loader may be silently failing or the "
            f"schedule that feeds them isn't running:\n\n{details}",
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Stale-source sweep failed (non-fatal): %s", exc)


def run_daily_pipeline():
    """Execute the standard daily ETL pipeline."""
    logger.info("=" * 60)
    logger.info("  DAILY PIPELINE — Starting")
    logger.info("=" * 60)

    registry = build_default_registry()
    results = run_pipeline(registry, triggered_by="schedule")

    succeeded = sum(1 for r in results if r.status == "success")
    failed = sum(1 for r in results if r.status == "error")
    unchanged = sum(
        1 for r in results if r.status in ("skipped_unchanged", "skipped_unverified")
    )
    unverified = sum(1 for r in results if r.status == "skipped_unverified")
    skipped = sum(1 for r in results if r.status == "skipped")

    logger.info(
        "Daily pipeline complete: %d succeeded, %d failed, %d unchanged "
        "(%d unverified), %d skipped",
        succeeded, failed, unchanged, unverified, skipped,
    )

    disk = check_disk_and_alert()
    disk_line = f"\n\nDisk: {disk['summary']}"

    if failed > 0:
        failed_names = [r.source for r in results if r.status == "error"]
        error_details = "\n".join(
            f"  - {r.source}: {(r.error_message or 'unknown')[:200]}"
            for r in results if r.status == "error"
        )
        send_alert(
            AlertLevel.ERROR,
            f"Daily ETL: {failed} job(s) failed",
            f"Failed jobs: {', '.join(failed_names)}\n\n{error_details}{disk_line}",
        )
    elif succeeded > 0:
        send_alert(
            AlertLevel.INFO,
            f"Daily ETL complete: {succeeded} succeeded, {unchanged} unchanged",
            f"All jobs completed successfully.{disk_line}",
        )

    # A "successful" run can still carry failed validations (non-blocking by
    # design) — surface those separately so they never hide behind the INFO
    # alert above.
    _alert_validation_failures(results, "Daily ETL")

    # Alert on any source that has drifted past its staleness threshold —
    # independent of this run's outcome, since the whole point is to catch
    # sources whose schedule silently stopped feeding them.
    _alert_stale_sources(registry, "Daily ETL")

    return results


def run_weekly_pipeline():
    """Execute a forced full refresh of all sources."""
    logger.info("=" * 60)
    logger.info("  WEEKLY FULL REFRESH — Starting")
    logger.info("=" * 60)

    registry = build_default_registry()
    results = run_pipeline(registry, triggered_by="schedule", force_refresh=True)

    failed = sum(1 for r in results if r.status == "error")

    disk = check_disk_and_alert()
    disk_line = f"\n\nDisk: {disk['summary']}"

    if failed > 0:
        failed_names = [r.source for r in results if r.status == "error"]
        send_alert(
            AlertLevel.ERROR,
            f"Weekly refresh: {failed} job(s) failed",
            f"Failed: {', '.join(failed_names)}{disk_line}",
        )
    else:
        send_alert(
            AlertLevel.INFO,
            "Weekly refresh complete",
            f"All jobs succeeded.{disk_line}",
        )

    _alert_validation_failures(results, "Weekly refresh")
    _alert_stale_sources(registry, "Weekly refresh")

    return results


def run_backup() -> bool:
    """Daily pg_dump + offsite R2 sync with 7-day rotation.

    Returns True only when the dump AND (if R2 is configured) the offsite
    upload both succeed; False otherwise. The heartbeat is pinged to match.

    Delegates to etl.backup — the one implementation of the dump itself.
    That module keeps the password off the pg_dump command line (PGPASSWORD
    instead of an inline URL, so it can't leak via /proc/<pid>/cmdline),
    applies the min_keep rotation guard locally and in R2, and gives the
    11M-row dump a 2-hour budget. This wrapper adds the scheduler-side
    concerns: alerting and the dead-man's-switch heartbeat.

    The backup directory is /backups inside the container, mounted as a
    Docker volume that maps to the host's /opt/calsight/backups on LXC 100.
    """
    from etl.backup import (  # noqa: PLC0415
        rotate_backups,
        rotate_r2_backups,
        run_backup as run_pg_dump,
        upload_to_r2,
    )

    backup_dir = os.environ.get("BACKUP_DIR", "/backups")

    try:
        backup_file = run_pg_dump(backup_dir)
        if backup_file is None:
            raise RuntimeError("pg_dump failed — see container logs")

        size_mb = backup_file.stat().st_size / (1024 * 1024)

        r2_ok = upload_to_r2(backup_file)
        if not r2_ok and os.environ.get("R2_BUCKET_NAME"):
            # R2 is configured but the upload failed. The local dump exists,
            # but offsite is the copy that survives the host dying, so this is
            # a real failure — raise so the heartbeat reports DOWN, matching
            # etl.backup's exit-code contract (PR #391). Pinging green here
            # would leave the dead-man's switch satisfied while offsite copies
            # silently go stale. Raising before rotation also avoids trimming
            # copies while uploads are broken.
            raise RuntimeError(
                f"{backup_file.name} ({size_mb:.1f} MB) saved locally but "
                "R2 offsite upload failed"
            )

        rotate_backups(backup_dir)
        rotate_r2_backups()

        logger.info(
            "Backup complete: %s (%.1f MB)%s",
            backup_file.name, size_mb, " — uploaded to R2" if r2_ok else "",
        )

        # Backup succeeded (local dump + offsite upload) — ping the
        # dead-man's-switch so the external monitor knows the box is alive and
        # ran the job on schedule.
        send_heartbeat(success=True)
        return True

    except Exception as exc:
        send_alert(AlertLevel.ERROR, "Backup failed", str(exc)[:500])
        logger.exception("Backup failed: %s", exc)
        send_heartbeat(success=False)
        return False


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
# Scheduler construction
# ---------------------------------------------------------------------------

def build_scheduler(no_backup: bool = False) -> BlockingScheduler:
    """Create the scheduler with all cron jobs registered and log the plan.

    Kept separate from main() so tests can exercise the full startup path
    without blocking: this exact code crash-looped the pipeline container in
    production for weeks (2026-07 incident) because pending APScheduler jobs
    have no `next_run_time` attribute until the scheduler starts, and nothing
    in CI ever ran it.
    """
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
    if not no_backup:
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
        if name == "backup" and no_backup:
            continue
        job = scheduler.get_job(name)
        # Jobs are "pending" until the scheduler starts and have no
        # next_run_time attribute yet — attribute access here raised
        # AttributeError and killed the container before start().
        next_run = getattr(job, "next_run_time", None) if job else None
        logger.info(
            "  %-20s  cron=%-15s  next=%s",
            name, config["cron"], next_run or "(computed at scheduler start)",
        )
    logger.info("=" * 60)

    return scheduler


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    _init_sentry()

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
            # Exit non-zero on backup failure so an exit-code-gated caller
            # (cron `&& curl $HEARTBEAT_URL`) sees it.
            return 0 if run_backup() else 1
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
    scheduler = build_scheduler(no_backup=args.no_backup)

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Pipeline scheduler stopped")

    return 0


if __name__ == "__main__":
    sys.exit(main())

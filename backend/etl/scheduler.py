"""Cron-based ETL scheduling via APScheduler.

Usage:
    python -m etl.scheduler              # Start scheduler (default: daily at 2 AM)
    python -m etl.scheduler --cron "0 */6 * * *"  # Every 6 hours
"""
import argparse
import logging
import sys

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from etl.jobs import build_default_registry
from etl.orchestrator import run_pipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


def scheduled_run():
    logger.info("Scheduled ETL run starting")
    registry = build_default_registry()
    results = run_pipeline(registry, triggered_by="schedule")
    succeeded = sum(1 for r in results if r.status == "success")
    failed = sum(1 for r in results if r.status == "error")
    logger.info("Scheduled run complete: %d succeeded, %d failed", succeeded, failed)


def main() -> int:
    parser = argparse.ArgumentParser(description="CalSight ETL Scheduler")
    parser.add_argument(
        "--cron",
        default="0 2 * * *",
        help="Cron expression for schedule (default: daily at 2 AM)",
    )
    args = parser.parse_args()

    scheduler = BlockingScheduler()
    trigger = CronTrigger.from_crontab(args.cron)
    scheduler.add_job(scheduled_run, trigger, id="etl_pipeline", replace_existing=True)

    logger.info("ETL scheduler started with cron: %s", args.cron)
    logger.info("Next run: %s", scheduler.get_job("etl_pipeline").next_run_time)

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Scheduler stopped")

    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Unified ETL entry point — replaces run_all_etl.sh.

Usage:
    python -m etl.run_all                  # Run all non-static jobs
    python -m etl.run_all --only crashes_ccrs,parties_victims
    python -m etl.run_all --include-static # Include SWITRS (normally skipped)
    python -m etl.run_all --dry-run        # Show execution order, don't run
"""
import argparse
import logging
import sys

from etl.jobs import build_default_registry
from etl.orchestrator import resolve_execution_order, run_pipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


def main() -> int:
    parser = argparse.ArgumentParser(description="CalSight ETL Orchestrator")
    parser.add_argument(
        "--only",
        help="Comma-separated list of job names to run (e.g. crashes_ccrs,demographics)",
    )
    parser.add_argument(
        "--include-static",
        action="store_true",
        help="Include static jobs (e.g. SWITRS) that normally don't need re-running",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show execution order without running anything",
    )
    parser.add_argument(
        "--triggered-by",
        default="manual",
        choices=["manual", "schedule", "api"],
        help="How this run was triggered (recorded in etl_runs)",
    )
    args = parser.parse_args()

    registry = build_default_registry()
    only = args.only.split(",") if args.only else None

    if args.dry_run:
        order = resolve_execution_order(registry)
        if only:
            order = [j for j in order if j.name in only]
        if not args.include_static:
            order = [j for j in order if j.schedule != "static"]

        print(f"\nExecution order ({len(order)} jobs):\n")
        for i, job in enumerate(order, 1):
            deps = f" (after: {', '.join(job.depends_on)})" if job.depends_on else ""
            print(f"  {i:2d}. {job.name:<25s} [{job.schedule}]{deps}")
        print()
        return 0

    logger.info("=" * 50)
    logger.info("  CalSight ETL Pipeline — Orchestrated Run")
    logger.info("=" * 50)

    results = run_pipeline(
        registry,
        triggered_by=args.triggered_by,
        only=only,
        skip_static=not args.include_static,
    )

    succeeded = sum(1 for r in results if r.status == "success")
    failed = sum(1 for r in results if r.status == "error")
    skipped = sum(1 for r in results if r.status == "skipped")

    logger.info("=" * 50)
    logger.info("  Complete: %d succeeded, %d failed, %d skipped", succeeded, failed, skipped)
    logger.info("=" * 50)

    return 1 if failed > 0 else 0


if __name__ == "__main__":
    sys.exit(main())

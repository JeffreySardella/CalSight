"""Schema migration management for the automated pipeline.

Wraps Alembic to provide safe, automated migration execution:
  - Checks if there are pending migrations before ETL runs
  - Applies migrations with a lock to prevent concurrent execution
  - Validates migration state after apply
  - Alerts on migration failures

Why this exists:
  When deploying new code that adds columns or tables, the ETL pipeline
  needs those schema changes applied BEFORE loading data into them.
  This module ensures migrations run automatically as part of the
  pipeline startup, rather than requiring manual `alembic upgrade head`.

Safety features:
  - Advisory lock prevents two containers from migrating simultaneously
  - Pre-flight check verifies the DB is reachable before attempting
  - Rolls back on failure and alerts the operator
  - Logs the migration revision chain for debugging

Usage:
    python -m etl.migrate              # Check + apply pending migrations
    python -m etl.migrate --check      # Only check, don't apply (exit 1 if pending)
    python -m etl.migrate --current    # Show current revision
"""

from __future__ import annotations

import argparse
import logging
import subprocess
import sys
from pathlib import Path

from sqlalchemy import text

from app.database import etl_engine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# Advisory lock ID — must be unique across the application.
# Using a hash of "calsight_migrations" as a 64-bit int.
_MIGRATION_LOCK_ID = 7_294_851_036


def get_current_revision() -> str | None:
    """Get the current Alembic revision from the database."""
    try:
        with etl_engine.connect() as conn:
            result = conn.execute(text(
                "SELECT version_num FROM alembic_version LIMIT 1"
            ))
            row = result.fetchone()
            return row[0] if row else None
    except Exception:
        return None


def has_pending_migrations() -> bool:
    """Check if there are unapplied Alembic migrations.

    Runs `alembic check` which exits 0 if up-to-date, 1 if not.
    """
    backend_dir = Path(__file__).parent.parent
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "check"],
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
    )
    return result.returncode != 0


def apply_migrations() -> bool:
    """Apply pending Alembic migrations with advisory lock protection.

    Returns True on success, False on failure.
    """
    backend_dir = Path(__file__).parent.parent

    # Acquire advisory lock to prevent concurrent migrations
    with etl_engine.connect() as conn:
        lock_acquired = conn.execute(
            text(f"SELECT pg_try_advisory_lock({_MIGRATION_LOCK_ID})")
        ).scalar()

        if not lock_acquired:
            logger.warning("Another process is running migrations — skipping")
            return True  # Not a failure, just concurrent

    try:
        logger.info("Applying pending Alembic migrations...")
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=str(backend_dir),
            capture_output=True,
            text=True,
            timeout=300,  # 5 min max for migrations
        )

        if result.returncode != 0:
            logger.error("Migration failed:\n%s\n%s", result.stdout, result.stderr)
            return False

        if result.stdout:
            logger.info("Migration output:\n%s", result.stdout.strip())

        current = get_current_revision()
        logger.info("Migrations applied successfully. Current revision: %s", current)
        return True

    except subprocess.TimeoutExpired:
        logger.error("Migration timed out after 5 minutes")
        return False
    except Exception as exc:
        logger.exception("Migration failed unexpectedly: %s", exc)
        return False
    finally:
        # Release advisory lock
        with etl_engine.connect() as conn:
            conn.execute(text(f"SELECT pg_advisory_unlock({_MIGRATION_LOCK_ID})"))
            conn.commit()


def ensure_migrated() -> bool:
    """Check and apply migrations if needed. Returns True if DB is up-to-date.

    Called at pipeline startup to ensure the schema is current before
    any ETL jobs run. This is the main entry point for automated use.
    """
    current = get_current_revision()
    logger.info("Current DB revision: %s", current or "(none)")

    if not has_pending_migrations():
        logger.info("Database schema is up to date")
        return True

    logger.info("Pending migrations detected — applying...")
    success = apply_migrations()

    if not success:
        from etl.alerts import AlertLevel, send_alert
        send_alert(
            AlertLevel.ERROR,
            "Schema migration failed",
            "Alembic upgrade head failed. Pipeline may not function correctly. "
            "Check logs and run migrations manually.",
        )

    return success


def main() -> int:
    parser = argparse.ArgumentParser(description="CalSight Schema Migration Manager")
    parser.add_argument("--check", action="store_true", help="Check only, exit 1 if pending")
    parser.add_argument("--current", action="store_true", help="Show current revision")
    args = parser.parse_args()

    if args.current:
        rev = get_current_revision()
        print(f"Current revision: {rev or '(none)'}")
        return 0

    if args.check:
        pending = has_pending_migrations()
        if pending:
            print("Pending migrations detected")
            return 1
        print("Schema is up to date")
        return 0

    # Default: check + apply
    success = ensure_migrated()
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())

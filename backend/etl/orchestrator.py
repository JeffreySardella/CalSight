from __future__ import annotations

import logging
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Literal

from sqlalchemy import func, select, text
from sqlalchemy import table as sa_table

from app.database import EtlSessionLocal as SessionLocal, etl_engine  # write/DDL role
from app.models import EtlRun

logger = logging.getLogger(__name__)

SourceType = Literal["ckan", "arcgis", "federal", "none"]


def _utc_now() -> datetime:
    """Naive UTC 'now'. EtlRun.started_at/finished_at are naive DateTime columns,
    so writing tz-aware values makes staleness math offset-dependent on non-UTC
    servers. Match the rest of the ETL code, which stores naive UTC (M-B12)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


@dataclass
class Job:
    name: str
    module: str
    args: list[str] = field(default_factory=list)
    depends_on: list[str] = field(default_factory=list)
    schedule: str = "daily"
    max_drop_pct: float = 10.0
    table_name: str | None = None
    timeout: int = 3600
    source_type: SourceType = "none"
    freshness_resource_id: str | None = None
    freshness_url: str | None = None
    freshness_table: str | None = None
    # CCRS resource-name prefix ("Crashes", "Parties", ...). When set, the
    # freshness probe resolves the NEWEST discovered year's resource instead
    # of the pinned freshness_resource_id — otherwise, the January a new year
    # is published, the pinned prior-year resource stops changing and the job
    # would skip as "unchanged" forever while a whole year goes missing.
    # freshness_resource_id remains the fallback when discovery fails.
    freshness_ckan_prefix: str | None = None


class JobRegistry:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}

    def register(self, job: Job) -> None:
        self._jobs[job.name] = job

    def get(self, name: str) -> Job:
        return self._jobs[name]

    @property
    def jobs(self) -> dict[str, Job]:
        return dict(self._jobs)


def resolve_execution_order(registry: JobRegistry) -> list[Job]:
    jobs = registry.jobs
    in_degree: dict[str, int] = {name: 0 for name in jobs}
    dependents: dict[str, list[str]] = {name: [] for name in jobs}

    for name, job in jobs.items():
        for dep in job.depends_on:
            if dep not in jobs:
                raise ValueError(
                    f"Job {name!r} depends on {dep!r} which is not registered"
                )
            dependents[dep].append(name)
            in_degree[name] += 1

    queue = [name for name, deg in in_degree.items() if deg == 0]
    order: list[Job] = []

    while queue:
        queue.sort()
        name = queue.pop(0)
        order.append(jobs[name])
        for dependent in dependents[name]:
            in_degree[dependent] -= 1
            if in_degree[dependent] == 0:
                queue.append(dependent)

    if len(order) != len(jobs):
        raise ValueError("Circular dependency detected in job graph")

    return order


_IDENT_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


def _table_row_count(db, table_name: str | None) -> int | None:
    """COUNT(*) for a job's target table, or None if it has none / errors.

    table_name comes from the trusted Job registry, never user input. We both
    validate the identifier AND build the statement with SQLAlchemy Core
    (func.count() over a table() clause) rather than interpolating the name
    into a raw SQL string — SQLAlchemy renders it as a quoted identifier, so
    the table name never flows into query text as concatenated SQL.
    """
    if not table_name:
        return None
    if not _IDENT_RE.match(table_name):
        logger.warning("Refusing to count suspicious table name: %r", table_name)
        return None
    try:
        stmt = select(func.count()).select_from(sa_table(table_name))
        return db.execute(stmt).scalar()
    except Exception as exc:
        logger.warning("Row count for %s failed: %s", table_name, exc)
        return None


def _validate_job(db, job: Job, rows_before: int | None) -> tuple[str, str | None]:
    """Run validation for a successful load and return (status, summary).

    status is one of: "passed", "warning", "failed", "skipped".
    Non-blocking: the caller keeps status="success" regardless — this only
    records what the checks found. A critical failure (e.g. a row-count drop
    beyond job.max_drop_pct) yields "failed"; non-critical issues yield
    "warning".
    """
    from etl.validation import check_row_count_growth, run_validation_suite

    try:
        report = run_validation_suite(db, source=job.name)

        # Row-count guard is per-job (max_drop_pct) and needs the before/after
        # counts, so it's added here rather than inside the source suite.
        if job.table_name and rows_before is not None:
            report.checks.append(
                check_row_count_growth(
                    db, job.table_name, rows_before, max_drop_pct=job.max_drop_pct,
                )
            )

        if not report.checks:
            return "skipped", None

        summary = "; ".join(
            f"{c.name}: {c.message}" for c in report.checks if not c.passed
        ) or report.summary()

        if report.critical_failures:
            logger.warning("Validation FAILED for %s: %s", job.name, summary)
            return "failed", summary[:2000]
        if report.warnings:
            logger.warning("Validation warnings for %s: %s", job.name, summary)
            return "warning", summary[:2000]
        return "passed", report.summary()
    except Exception as exc:
        # A broken check must not fail an otherwise-successful load.
        logger.exception("Validation errored for %s: %s", job.name, exc)
        return "skipped", f"validation error: {str(exc)[:500]}"


def run_job(job: Job, triggered_by: str = "manual", force_refresh: bool = False) -> EtlRun:
    from etl._utils import check_source_freshness

    db = SessionLocal()

    freshness = None
    if not force_refresh and job.source_type != "none":
        freshness = check_source_freshness(job, db)
        logger.info("Freshness check for %s: %s", job.name, freshness.reason)

        if not freshness.is_fresh:
            record = EtlRun(
                source=job.name,
                status="skipped_unchanged",
                started_at=_utc_now(),
                finished_at=_utc_now(),
                triggered_by=triggered_by,
                error_message=freshness.reason,
                validation_status="skipped",
                last_source_modified=freshness.last_source_modified,
                source_row_count=freshness.source_row_count,
            )
            db.add(record)
            db.commit()
            db.refresh(record)
            db.expunge(record)
            db.close()
            return record

    rows_before = _table_row_count(db, job.table_name)

    record = EtlRun(
        source=job.name,
        status="running",
        started_at=_utc_now(),
        triggered_by=triggered_by,
        rows_before=rows_before,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    logger.info("Starting job %s (id=%d)", job.name, record.id)
    cmd = [sys.executable, "-m", job.module] + job.args
    start = time.monotonic()

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=job.timeout,
        )
        elapsed = time.monotonic() - start

        if result.returncode != 0:
            record.status = "error"
            desc = _describe_exit_code(result.returncode)
            stderr_tail = result.stderr[-1800:] if result.stderr else ""
            record.error_message = f"{desc}\n{stderr_tail}".strip() if stderr_tail else desc
            record.validation_status = "skipped"
        else:
            record.status = "success"
            if freshness:
                record.last_source_modified = freshness.last_source_modified
                record.source_row_count = freshness.source_row_count
            # Run the validation suite against the freshly-loaded data and
            # record the REAL outcome. Validation is non-blocking (a failure
            # doesn't flip the load to error), but the status must reflect
            # what actually happened — a truncated source that halved a table
            # should read "failed", not a fabricated "passed".
            record.rows_after = _table_row_count(db, job.table_name)
            val_status, diff_summary = _validate_job(db, job, record.rows_before)
            record.validation_status = val_status
            record.diff_summary = diff_summary

        record.finished_at = _utc_now()
        db.commit()
        logger.info("Job %s finished in %.1fs (status=%s)", job.name, elapsed, record.status)

    except subprocess.TimeoutExpired:
        record.status = "error"
        record.error_message = f"Job timed out after {job.timeout}s"
        record.finished_at = _utc_now()
        record.validation_status = "skipped"
        db.commit()
        logger.error("Job %s timed out", job.name)

    except Exception as exc:
        record.status = "error"
        record.error_message = str(exc)[:2000]
        record.finished_at = _utc_now()
        record.validation_status = "skipped"
        db.commit()
        logger.exception("Job %s failed unexpectedly", job.name)

    finally:
        db.refresh(record)
        db.expunge(record)
        db.close()

    return record


def _cleanup_zombie_runs() -> int:
    """Mark stale 'running' records as errors — these are from killed processes."""
    db = SessionLocal()
    try:
        zombies = (
            db.query(EtlRun)
            .filter(
                EtlRun.status == "running",
                EtlRun.started_at < _utc_now() - timedelta(hours=1),
            )
            .all()
        )
        for z in zombies:
            z.status = "error"
            z.error_message = "Zombie cleanup: process was killed or never finished"
            z.finished_at = _utc_now()
        db.commit()
        if zombies:
            logger.info("Cleaned up %d zombie etl_runs", len(zombies))
        return len(zombies)
    finally:
        db.close()


def _describe_exit_code(returncode: int) -> str:
    """Return a human-readable description of a process exit code."""
    if returncode == 137:
        return "Process killed (OOM or SIGKILL, exit 137)"
    if returncode == 139:
        return "Segmentation fault (exit 139)"
    if returncode > 128:
        sig = returncode - 128
        return f"Killed by signal {sig} (exit {returncode})"
    return f"Non-zero exit code {returncode}"


_PIPELINE_LOCK_ID = 839271  # arbitrary advisory lock key


def run_pipeline(
    registry: JobRegistry,
    triggered_by: str = "manual",
    only: list[str] | None = None,
    skip_static: bool = True,
    force_refresh: bool = False,
) -> list[EtlRun]:
    # Hold the advisory lock on a dedicated AUTOCOMMIT connection. A session
    # would auto-begin a transaction here and keep it open ("idle in
    # transaction") for the entire multi-hour run, pinning the xmin horizon
    # so autovacuum — and our own tail-end vacuum job — couldn't reclaim any
    # dead tuples the load itself produces on the 11M-row table. Session-level
    # advisory locks live on the connection, not a transaction, so AUTOCOMMIT
    # holds the lock just as well without blocking vacuum.
    lock_conn = etl_engine.connect().execution_options(isolation_level="AUTOCOMMIT")
    try:
        acquired = lock_conn.execute(
            text("SELECT pg_try_advisory_lock(:id)"), {"id": _PIPELINE_LOCK_ID}
        ).scalar()
        if not acquired:
            logger.warning("Pipeline already running (advisory lock held), skipping")
            lock_conn.close()
            return []
    except Exception:
        lock_conn.close()
        raise

    try:
        return _run_pipeline_locked(registry, triggered_by, only, skip_static, force_refresh)
    finally:
        try:
            lock_conn.execute(
                text("SELECT pg_advisory_unlock(:id)"), {"id": _PIPELINE_LOCK_ID}
            )
        finally:
            lock_conn.close()


def _run_pipeline_locked(
    registry: JobRegistry,
    triggered_by: str = "manual",
    only: list[str] | None = None,
    skip_static: bool = True,
    force_refresh: bool = False,
) -> list[EtlRun]:
    _cleanup_zombie_runs()
    order = resolve_execution_order(registry)

    if only:
        order = [j for j in order if j.name in only]

    if skip_static:
        order = [j for j in order if j.schedule != "static"]

    results: list[EtlRun] = []
    failed: set[str] = set()
    skipped_unchanged: set[str] = set()

    for job in order:
        blocked_by = [dep for dep in job.depends_on if dep in failed]
        if blocked_by:
            logger.warning("Skipping %s — blocked by failed: %s", job.name, blocked_by)
            db = SessionLocal()
            record = EtlRun(
                source=job.name,
                status="skipped",
                started_at=_utc_now(),
                finished_at=_utc_now(),
                triggered_by=triggered_by,
                error_message=f"Blocked by failed deps: {', '.join(blocked_by)}",
                validation_status="skipped",
            )
            db.add(record)
            db.commit()
            db.refresh(record)
            db.expunge(record)
            db.close()
            results.append(record)
            failed.add(job.name)
            continue

        if (
            not force_refresh
            and job.source_type == "none"
            and job.depends_on
            and all(dep in skipped_unchanged for dep in job.depends_on)
        ):
            logger.info("Skipping %s — all deps unchanged: %s", job.name, job.depends_on)
            db = SessionLocal()
            record = EtlRun(
                source=job.name,
                status="skipped_unchanged",
                started_at=_utc_now(),
                finished_at=_utc_now(),
                triggered_by=triggered_by,
                error_message=f"All dependencies unchanged: {', '.join(job.depends_on)}",
                validation_status="skipped",
            )
            db.add(record)
            db.commit()
            db.refresh(record)
            db.expunge(record)
            db.close()
            results.append(record)
            skipped_unchanged.add(job.name)
            continue

        record = run_job(job, triggered_by=triggered_by, force_refresh=force_refresh)
        results.append(record)
        if record.status == "error":
            failed.add(job.name)
        elif record.status == "skipped_unchanged":
            skipped_unchanged.add(job.name)

    return results

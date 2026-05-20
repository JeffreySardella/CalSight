from __future__ import annotations

import logging
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from app.models import EtlRun

logger = logging.getLogger(__name__)

SourceType = Literal["ckan", "arcgis", "federal", "none"]


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
                started_at=datetime.utcnow(),
                finished_at=datetime.utcnow(),
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

    record = EtlRun(
        source=job.name,
        status="running",
        started_at=datetime.utcnow(),
        triggered_by=triggered_by,
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
            record.validation_status = "passed"
            if freshness:
                record.last_source_modified = freshness.last_source_modified
                record.source_row_count = freshness.source_row_count

        record.finished_at = datetime.utcnow()
        db.commit()
        logger.info("Job %s finished in %.1fs (status=%s)", job.name, elapsed, record.status)

    except subprocess.TimeoutExpired:
        record.status = "error"
        record.error_message = f"Job timed out after {job.timeout}s"
        record.finished_at = datetime.utcnow()
        record.validation_status = "skipped"
        db.commit()
        logger.error("Job %s timed out", job.name)

    except Exception as exc:
        record.status = "error"
        record.error_message = str(exc)[:2000]
        record.finished_at = datetime.utcnow()
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
                EtlRun.started_at < datetime.utcnow() - __import__("datetime").timedelta(hours=1),
            )
            .all()
        )
        for z in zombies:
            z.status = "error"
            z.error_message = "Zombie cleanup: process was killed or never finished"
            z.finished_at = datetime.utcnow()
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


def run_pipeline(
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
                started_at=datetime.utcnow(),
                finished_at=datetime.utcnow(),
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
                started_at=datetime.utcnow(),
                finished_at=datetime.utcnow(),
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

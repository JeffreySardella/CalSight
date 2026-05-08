from __future__ import annotations

import logging
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime

from app.database import SessionLocal
from app.models import EtlRun

logger = logging.getLogger(__name__)


@dataclass
class Job:
    name: str
    module: str
    args: list[str] = field(default_factory=list)
    depends_on: list[str] = field(default_factory=list)
    schedule: str = "daily"
    max_drop_pct: float = 10.0
    table_name: str | None = None


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


def run_job(job: Job, triggered_by: str = "manual") -> EtlRun:
    db = SessionLocal()
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
            timeout=3600,
        )
        elapsed = time.monotonic() - start

        if result.returncode != 0:
            record.status = "error"
            record.error_message = result.stderr[-2000:] if result.stderr else "Non-zero exit code"
            record.validation_status = "skipped"
        else:
            record.status = "success"
            record.validation_status = "passed"

        record.finished_at = datetime.utcnow()
        db.commit()
        logger.info("Job %s finished in %.1fs (status=%s)", job.name, elapsed, record.status)

    except subprocess.TimeoutExpired:
        record.status = "error"
        record.error_message = "Job timed out after 3600s"
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
        db.expunge(record)
        db.close()

    return record


def run_pipeline(
    registry: JobRegistry,
    triggered_by: str = "manual",
    only: list[str] | None = None,
    skip_static: bool = True,
) -> list[EtlRun]:
    order = resolve_execution_order(registry)

    if only:
        order = [j for j in order if j.name in only]

    if skip_static:
        order = [j for j in order if j.schedule != "static"]

    results: list[EtlRun] = []
    failed: set[str] = set()

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
            db.close()
            results.append(record)
            failed.add(job.name)
            continue

        record = run_job(job, triggered_by=triggered_by)
        results.append(record)
        if record.status == "error":
            failed.add(job.name)

    return results

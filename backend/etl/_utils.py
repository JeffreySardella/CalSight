"""Shared utilities for ETL scripts.

Centralizes patterns that were repeated across many of the 15+ loaders:

  - safe_int / safe_float: None-safe type coercion for values coming from
    APIs that return strings which can be empty or malformed.

  - get_with_retry / post_with_retry: HTTP helpers with exponential backoff
    on network errors and 5xx responses. Used by scripts that talk to
    public APIs (CKAN, ArcGIS, BLS) which occasionally 503 or time out.

  - etl_run: context manager that records an EtlRun row for the duration
    of a pipeline, capturing started_at / finished_at / status / error.
    Previously only load_crashes.py wrote to EtlRun; this makes it a
    one-line addition for every loader.

New code should import from here. Existing scripts that have their own
_safe_int / _safe_float helpers still work — those can be migrated over
time without breaking anything.

Example:

    from etl._utils import etl_run, safe_int, get_with_retry

    def run():
        with etl_run("hospitals") as run_record:
            resp = get_with_retry(url, params=params)
            # ... transform and load ...
            run_record.rows_loaded = total
"""

from __future__ import annotations

import functools
import logging
import os
import time
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Callable, Iterator, TypeVar

import httpx
from sqlalchemy import desc, text

from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from app.models import EtlRun
from etl.ckan_api import discover_resource_ids

if TYPE_CHECKING:
    from etl.orchestrator import Job

logger = logging.getLogger(__name__)

F = TypeVar("F", bound=Callable[..., Any])


# ---------------------------------------------------------------------------
# Type coercion
# ---------------------------------------------------------------------------

def dedupe_rows(rows: list[dict], key: tuple[str, ...]) -> list[dict]:
    """Drop earlier duplicates of *key* from a batch, keeping the last.

    CKAN pages occasionally repeat a source row. Two rows with the same
    conflict key inside one INSERT ... ON CONFLICT statement make Postgres
    raise "cannot affect row a second time", failing the entire batch — so
    every bulk upsert dedupes on its conflict key first. Last occurrence
    wins (matches what sequential upserts would have produced); relative
    order is otherwise preserved.
    """
    by_key: dict[tuple, dict] = {}
    for row in rows:
        by_key[tuple(row.get(k) for k in key)] = row
    return list(by_key.values())


def safe_int(value: Any) -> int | None:
    """Coerce *value* to int; return None for None / empty / bad input.

    Useful for upstream data where fields can be blank strings, the literal
    string "null", floats that should be rounded, etc.
    """
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def safe_float(value: Any) -> float | None:
    """Coerce *value* to float; return None for None / empty / bad input."""
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# HTTP with retry
# ---------------------------------------------------------------------------

# Retry on transient network errors and 5xx responses. 4xx errors are
# client mistakes and are NOT retried — no amount of retrying fixes a 404
# or a 401. The caller should see those immediately.
_RETRIABLE_EXCEPTIONS = (httpx.RequestError,)


def _should_retry_status(exc: httpx.HTTPStatusError) -> bool:
    return 500 <= exc.response.status_code < 600


def _sleep_backoff(attempt: int, base: float) -> float:
    """Return the number of seconds slept so the caller can log it."""
    sleep_for = base ** (attempt + 1)
    time.sleep(sleep_for)
    return sleep_for


def get_with_retry(
    url: str,
    *,
    max_retries: int = 3,
    backoff_base: float = 2.0,
    timeout: float = 60.0,
    **kwargs,
) -> httpx.Response:
    """HTTP GET with exponential backoff on transient failures.

    Retries 5xx and network errors up to *max_retries* times, sleeping
    backoff_base^(attempt+1) seconds between tries. Raises the last
    error on final failure so the caller still sees it.

    Kwargs (params, headers, auth, etc.) are forwarded to httpx.get.
    """
    last_error: Exception | None = None
    for attempt in range(max_retries):
        try:
            resp = httpx.get(url, timeout=timeout, **kwargs)
            resp.raise_for_status()
            return resp
        except httpx.HTTPStatusError as exc:
            last_error = exc
            if not _should_retry_status(exc):
                raise
            if attempt < max_retries - 1:
                slept = _sleep_backoff(attempt, backoff_base)
                logger.warning(
                    "GET %s -> %d (attempt %d/%d); retrying in %.1fs",
                    url, exc.response.status_code, attempt + 1, max_retries, slept,
                )
        except _RETRIABLE_EXCEPTIONS as exc:
            last_error = exc
            if attempt < max_retries - 1:
                slept = _sleep_backoff(attempt, backoff_base)
                logger.warning(
                    "GET %s failed (attempt %d/%d): %s — retrying in %.1fs",
                    url, attempt + 1, max_retries, exc, slept,
                )
    assert last_error is not None
    raise last_error


def post_with_retry(
    url: str,
    *,
    max_retries: int = 3,
    backoff_base: float = 2.0,
    timeout: float = 60.0,
    **kwargs,
) -> httpx.Response:
    """HTTP POST with same retry semantics as get_with_retry.

    Kwargs (json, data, headers, etc.) are forwarded to httpx.post.
    """
    last_error: Exception | None = None
    for attempt in range(max_retries):
        try:
            resp = httpx.post(url, timeout=timeout, **kwargs)
            resp.raise_for_status()
            return resp
        except httpx.HTTPStatusError as exc:
            last_error = exc
            if not _should_retry_status(exc):
                raise
            if attempt < max_retries - 1:
                slept = _sleep_backoff(attempt, backoff_base)
                logger.warning(
                    "POST %s -> %d (attempt %d/%d); retrying in %.1fs",
                    url, exc.response.status_code, attempt + 1, max_retries, slept,
                )
        except _RETRIABLE_EXCEPTIONS as exc:
            last_error = exc
            if attempt < max_retries - 1:
                slept = _sleep_backoff(attempt, backoff_base)
                logger.warning(
                    "POST %s failed (attempt %d/%d): %s — retrying in %.1fs",
                    url, attempt + 1, max_retries, exc, slept,
                )
    assert last_error is not None
    raise last_error


# ---------------------------------------------------------------------------
# EtlRun tracking
# ---------------------------------------------------------------------------

# Set by etl.orchestrator.run_job in the environment of every job subprocess
# it spawns. When present, etl_run()/track_etl_run() skip self-tracking —
# run_job's etl_runs row (keyed by the registry job name) is the single
# source of truth for orchestrated runs. Direct CLI runs (no flag) keep
# self-tracking. See audit M-B8: without this, every orchestrated job that
# also self-tracked produced two etl_runs rows per run.
ORCHESTRATED_ENV_FLAG = "CALSIGHT_ORCHESTRATED"


def _is_orchestrated() -> bool:
    return os.environ.get(ORCHESTRATED_ENV_FLAG) == "1"


@contextmanager
def etl_run(source: str) -> Iterator[EtlRun]:
    """Track an ETL pipeline run in the etl_runs table.

    Creates an EtlRun row with status='running' when the block is entered,
    marks it 'success' when the block exits cleanly, and marks it 'error'
    with the exception message if anything raises. The exception is
    re-raised so the caller's normal error handling still fires.

    The caller can set rows_loaded on the yielded object to record how
    many rows the pipeline touched (for dashboards and debugging).

    This uses its own DB session so it won't interfere with whatever
    transaction the caller has open for data work.

    Example:

        def run():
            with etl_run("hospitals") as run_record:
                db = SessionLocal()
                try:
                    total = do_work(db)
                    run_record.rows_loaded = total
                finally:
                    db.close()
    """
    # Orchestrated runs: etl.orchestrator.run_job already owns the etl_runs
    # row for this job (status, timing, validation) and sets the flag on the
    # subprocess env. Writing a second row here duplicated every orchestrated
    # run — and under the module's own source name ("generate_insights") vs
    # the registry job name ("insights"), polluting freshness lookups (M-B8).
    # Yield a transient, never-persisted record so callers can still set
    # rows_loaded etc.; exceptions propagate unchanged for run_job to record.
    if _is_orchestrated():
        logger.info(
            "EtlRun tracking for source=%r delegated to orchestrator (%s=1)",
            source, ORCHESTRATED_ENV_FLAG,
        )
        yield EtlRun(source=source, status="running")
        return

    db = SessionLocal()
    record = EtlRun(
        source=source,
        status="running",
        started_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    logger.info("EtlRun id=%d started for source=%r", record.id, source)

    try:
        yield record
    except SystemExit as exc:
        # sys.exit() inside a tracked run (e.g. missing credentials).
        # SystemExit derives from BaseException, so the Exception handler
        # below never sees it — without this branch the EtlRun row would
        # be stranded in status='running'. A non-zero code records an
        # error; sys.exit(0) / sys.exit() is a clean exit.
        if exc.code in (None, 0):
            record.status = "success"
            record.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.commit()
        else:
            try:
                record.status = "error"
                record.error_message = f"exited with code {exc.code}"
                record.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
                db.commit()
            except Exception:
                db.rollback()
            logger.error("EtlRun id=%d failed: exit code %s", record.id, exc.code)
        raise
    except Exception as exc:
        try:
            record.status = "error"
            record.error_message = str(exc)
            record.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.commit()
        except Exception:
            db.rollback()
        logger.error("EtlRun id=%d failed: %s", record.id, exc)
        raise
    else:
        record.status = "success"
        record.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()
        logger.info(
            "EtlRun id=%d success; rows_loaded=%s",
            record.id,
            record.rows_loaded if record.rows_loaded is not None else "unset",
        )
    finally:
        db.close()


def track_etl_run(source: str) -> Callable[[F], F]:
    """Decorator form of etl_run — attaches EtlRun tracking to a function.

    Use this instead of etl_run() when you want to wrap an existing run()
    without re-indenting its body. The decorated function's return value
    is recorded as rows_loaded if it's an int, otherwise ignored.

    Example:

        from etl._utils import track_etl_run

        @track_etl_run("hospitals")
        def run() -> int:
            # ...do work...
            return total_rows  # captured into EtlRun.rows_loaded

    The decorator doesn't swallow exceptions — they propagate to the
    caller so existing error handling (and sys.exit calls) still work.
    """

    def decorator(func: F) -> F:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            with etl_run(source) as record:
                result = func(*args, **kwargs)
                if isinstance(result, int):
                    record.rows_loaded = result
                return result

        return wrapper  # type: ignore[return-value]

    return decorator


# ---------------------------------------------------------------------------
# Source freshness checking
# ---------------------------------------------------------------------------

CKAN_RESOURCE_SHOW_URL = "https://data.ca.gov/api/3/action/resource_show"


@dataclass
class FreshnessResult:
    is_fresh: bool
    last_source_modified: datetime | None
    source_row_count: int | None
    reason: str
    # Did we actually reach the UPSTREAM source and get a definitive signal?
    #
    #   True  — we contacted upstream (CKAN resource_show last_modified, an
    #           ArcGIS feature count, etc.) and it told us whether the data
    #           changed. A `is_fresh=False` here is a genuine "verified
    #           unchanged" and legitimately counts as a confirmed sync.
    #
    #   False — we could NOT verify upstream: the host was unreachable / 404,
    #           or the only signal we have is our OWN target table's row count,
    #           which says nothing about whether upstream moved. A skip like
    #           this must NOT masquerade as a healthy sync — otherwise a dead
    #           endpoint or a frozen year-pinned loader reads "fresh" forever
    #           and the source silently fossilizes (audit M8).
    #
    # Only meaningful when is_fresh is False (a skip). When is_fresh is True the
    # job runs regardless, so the flag is left at its default.
    upstream_verified: bool = True


def check_source_freshness(job: Job, db_session) -> FreshnessResult:
    """Check whether a source has new data since the last successful run.

    Returns is_fresh=False when source is unchanged and job should be
    skipped.  Returns is_fresh=True when source has new data, or when
    no prior successful run exists (first-time load always runs).
    """
    if job.source_type == "none":
        return FreshnessResult(True, None, None, "no freshness config")

    last_run = (
        db_session.query(EtlRun)
        .filter(EtlRun.source == job.name, EtlRun.status == "success")
        .order_by(desc(EtlRun.finished_at))
        .first()
    )

    if last_run is None:
        return FreshnessResult(True, None, None, "no prior successful run")

    if job.source_type == "ckan":
        return _check_ckan_freshness(job, last_run)
    if job.source_type == "arcgis":
        return _check_arcgis_freshness(job, last_run)
    if job.source_type == "federal":
        return _check_federal_freshness(job, last_run, db_session)

    return FreshnessResult(True, None, None, f"unknown source_type {job.source_type!r}")


def _resolve_ckan_freshness_resource(job: Job) -> str | None:
    """The resource id whose last_modified decides whether this job runs.

    Jobs with a freshness_ckan_prefix probe the newest discovered year's
    resource (see Job.freshness_ckan_prefix); everything else — and any
    discovery failure — uses the pinned freshness_resource_id.
    """
    prefix = getattr(job, "freshness_ckan_prefix", None)
    if prefix:
        discovered = discover_resource_ids(prefix)
        if discovered:
            return discovered[max(discovered)]
    return job.freshness_resource_id


def _check_ckan_freshness(job: Job, last_run: EtlRun) -> FreshnessResult:
    resource_id = _resolve_ckan_freshness_resource(job)
    if not resource_id:
        return FreshnessResult(True, None, None, "ckan type but no resource_id")

    try:
        resp = get_with_retry(
            CKAN_RESOURCE_SHOW_URL,
            params={"id": resource_id},
            timeout=15.0,
        )
        resource = resp.json().get("result", {})
        modified_str = resource.get("last_modified") or resource.get("created")
        if not modified_str:
            return FreshnessResult(True, None, None, "ckan returned no timestamp")

        source_modified = datetime.fromisoformat(
            modified_str.replace("Z", "+00:00")
        ).replace(tzinfo=None)

        if source_modified <= last_run.finished_at:
            return FreshnessResult(
                False, source_modified, None,
                f"source unchanged ({source_modified.isoformat()} <= {last_run.finished_at.isoformat()})",
            )

        return FreshnessResult(
            True, source_modified, None,
            f"source updated ({source_modified.isoformat()} > {last_run.finished_at.isoformat()})",
        )
    except Exception as exc:
        logger.warning("CKAN freshness check failed for %s: %s", job.name, exc)
        return FreshnessResult(True, None, None, f"freshness check error: {exc}")


def _check_arcgis_freshness(job: Job, last_run: EtlRun) -> FreshnessResult:
    if not job.freshness_url:
        return FreshnessResult(True, None, None, "arcgis type but no freshness_url")

    try:
        resp = get_with_retry(
            job.freshness_url,
            params={"where": "1=1", "returnCountOnly": "true", "f": "json"},
            timeout=15.0,
        )
        count = resp.json().get("count")
        if count is None:
            return FreshnessResult(True, None, None, "arcgis returned no count")

        prior_count = last_run.source_row_count
        if prior_count is not None and count == prior_count:
            # We DID reach the ArcGIS service and it reports the same feature
            # count — a real upstream signal, so this counts as a verified sync.
            return FreshnessResult(
                False, None, count,
                f"upstream reports feature count unchanged at {count}",
                upstream_verified=True,
            )

        return FreshnessResult(
            True, None, count,
            f"row count changed: {prior_count} -> {count}" if prior_count else f"first count: {count}",
        )
    except (httpx.RequestError, httpx.HTTPStatusError) as exc:
        # The upstream host is unreachable or erroring (e.g. geo.dot.gov
        # returning 5xx). This is an outage we can't fix by running the load —
        # the loader would just hit the same dead host and fail the whole
        # pipeline. Skip this cycle instead, leaving the last good data in
        # place; the next run retries automatically once the source recovers.
        #
        # But we did NOT verify upstream: an endpoint that 404s / 5xxes forever
        # (e.g. a decommissioned 2022-vintage service) would otherwise skip
        # every cycle and read "fresh" indefinitely. Mark it unverified so the
        # freshness API surfaces the outage as stale once the threshold passes
        # (audit M8) instead of silently pinning the last good count.
        logger.warning("ArcGIS source unreachable for %s: %s — skipping run", job.name, exc)
        return FreshnessResult(
            False, None, last_run.source_row_count,
            f"could not verify upstream: source unreachable ({exc}); "
            "skipping run, will retry next cycle",
            upstream_verified=False,
        )
    except Exception as exc:
        logger.warning("ArcGIS freshness check failed for %s: %s", job.name, exc)
        return FreshnessResult(True, None, None, f"freshness check error: {exc}")


_ALLOWED_FRESHNESS_TABLES = {
    "demographics", "weather", "unemployment_rates",
    "fars_county_year", "tract_density_county_year",
}


def _check_federal_freshness(job: Job, last_run: EtlRun, db_session) -> FreshnessResult:
    if not job.freshness_table:
        return FreshnessResult(True, None, None, "federal type but no freshness_table")

    if job.freshness_table not in _ALLOWED_FRESHNESS_TABLES:
        return FreshnessResult(True, None, None, f"unknown freshness_table {job.freshness_table!r}")

    try:
        current_count = int(
            db_session.execute(text(f"SELECT COUNT(*) FROM {job.freshness_table}")).scalar()  # noqa: S608
        )
        prior_count = last_run.source_row_count

        if prior_count is not None and current_count == prior_count:
            # This is our OWN target table's row count, not an upstream probe.
            # An unchanged count can mean "upstream genuinely unchanged" OR
            # "the loader silently added nothing / is year-pinned / failed" —
            # we cannot tell them apart from here. Skip the reload (no point
            # re-loading identical data) but mark it UNVERIFIED so the source
            # isn't perpetually reported as a confirmed sync; the freshness API
            # then surfaces it as stale once its threshold elapses (audit M8).
            return FreshnessResult(
                False, None, current_count,
                f"could not verify upstream: no cheap upstream probe for "
                f"{job.name}; own DB row count unchanged at {current_count}",
                upstream_verified=False,
            )

        return FreshnessResult(
            True, None, current_count,
            f"DB count changed: {prior_count} -> {current_count}" if prior_count else f"first count: {current_count}",
        )
    except Exception as exc:
        logger.warning("Federal freshness check failed for %s: %s", job.name, exc)
        return FreshnessResult(True, None, None, f"freshness check error: {exc}")

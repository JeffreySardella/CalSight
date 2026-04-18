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
import time
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Callable, Iterator, TypeVar

import httpx

from app.database import SessionLocal
from app.models import EtlRun

logger = logging.getLogger(__name__)

F = TypeVar("F", bound=Callable[..., Any])


# ---------------------------------------------------------------------------
# Type coercion
# ---------------------------------------------------------------------------

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
    db = SessionLocal()
    record = EtlRun(
        source=source,
        status="running",
        started_at=datetime.utcnow(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    logger.info("EtlRun id=%d started for source=%r", record.id, source)

    try:
        yield record
    except Exception as exc:
        try:
            record.status = "error"
            record.error_message = str(exc)
            record.finished_at = datetime.utcnow()
            db.commit()
        except Exception:
            db.rollback()
        logger.error("EtlRun id=%d failed: %s", record.id, exc)
        raise
    else:
        record.status = "success"
        record.finished_at = datetime.utcnow()
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

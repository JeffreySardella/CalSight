"""Unit tests for the street-aggregation statement-timeout tiering.

The statewide (no-county) aggregate scans the whole crashes table, which grows
nightly. A single flat 30s bound was eventually exceeded, so the endpoint hung
for 30s and then 500'd — in the app's default no-filter state. These tests pin
the two behaviours that fix it: the unbounded scan gets more headroom, and a
timeout degrades to an honest 503 rather than a bare 500.
"""

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import OperationalError

from app.routers.intersections import (
    _STATEMENT_TIMEOUT_MS,
    _STATEWIDE_STATEMENT_TIMEOUT_MS,
    _apply_scan_timeout,
    _degrade_on_timeout,
)


def _timeout_error() -> OperationalError:
    return OperationalError("SELECT 1", {}, Exception("canceling statement due to statement timeout"))


def test_statewide_gets_more_headroom_than_scoped():
    assert _STATEWIDE_STATEMENT_TIMEOUT_MS > _STATEMENT_TIMEOUT_MS


def test_no_county_applies_statewide_timeout():
    db = MagicMock()
    with patch("app.routers.intersections.apply_statement_timeout") as applied:
        assert _apply_scan_timeout(db, None) == _STATEWIDE_STATEMENT_TIMEOUT_MS
    applied.assert_called_once_with(db, _STATEWIDE_STATEMENT_TIMEOUT_MS)


def test_county_scoped_keeps_the_tighter_timeout():
    db = MagicMock()
    with patch("app.routers.intersections.apply_statement_timeout") as applied:
        assert _apply_scan_timeout(db, 19) == _STATEMENT_TIMEOUT_MS
    applied.assert_called_once_with(db, _STATEMENT_TIMEOUT_MS)


def test_timeout_becomes_503_with_retry_after():
    db = MagicMock()
    with pytest.raises(HTTPException) as exc_info:
        with _degrade_on_timeout(db, _STATEWIDE_STATEMENT_TIMEOUT_MS, "corridors"):
            raise _timeout_error()

    err = exc_info.value
    assert err.status_code == 503, "a too-big query is not an internal server error"
    assert err.headers.get("Retry-After") == "60"
    # The message must tell the caller what to actually do about it.
    assert "county" in err.detail and "year" in err.detail


def test_timeout_rolls_back_the_aborted_transaction():
    """Without the rollback the connection returns to the pool poisoned."""
    db = MagicMock()
    with pytest.raises(HTTPException):
        with _degrade_on_timeout(db, _STATEWIDE_STATEMENT_TIMEOUT_MS, "corridors"):
            raise _timeout_error()
    db.rollback.assert_called_once()


def test_success_path_is_untouched():
    db = MagicMock()
    with _degrade_on_timeout(db, _STATEMENT_TIMEOUT_MS, "intersections"):
        result = "ok"
    assert result == "ok"
    db.rollback.assert_not_called()


def test_non_timeout_errors_still_propagate():
    """Only DB-level timeouts degrade; real bugs must not be masked as 503."""
    db = MagicMock()
    with pytest.raises(ValueError):
        with _degrade_on_timeout(db, _STATEMENT_TIMEOUT_MS, "intersections"):
            raise ValueError("a genuine bug")

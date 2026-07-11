"""Unit guards for the ETL router (audit M19 + M-B2 nit).

POST /api/etl/run guards a constant-time key check, but without a rate limit
it was the only endpoint allowing unthrottled online brute-force of the ETL
API key. And `only.split(",")` used to hand the orchestrator whitespace-
padded names (`?only=parties, victims` silently ran zero jobs).
"""

import inspect

from app.routers.etl import _parse_only, trigger_etl_run


# ── only= parsing ───────────────────────────────────────────────────────


def test_parse_only_none_and_empty():
    assert _parse_only(None) is None
    assert _parse_only("") is None


def test_parse_only_single_job():
    assert _parse_only("parties") == ["parties"]


def test_parse_only_strips_whitespace_around_names():
    assert _parse_only("parties, victims") == ["parties", "victims"]
    assert _parse_only(" parties ,victims ") == ["parties", "victims"]


def test_parse_only_drops_empty_segments():
    assert _parse_only("parties,,victims,") == ["parties", "victims"]
    # All-empty input must mean "no restriction was parsed", not [].
    assert _parse_only(" , ,") is None


# ── rate limit present ──────────────────────────────────────────────────


def test_trigger_etl_run_is_rate_limited():
    """Source-level guard, same style as test_statement_timeouts: the run
    trigger must carry the 5/minute limit its siblings (admin verify) use."""
    src = inspect.getsource(trigger_etl_run)
    assert '@_limiter.limit("5/minute")' in src

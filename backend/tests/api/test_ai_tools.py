"""Integration tests for app.ai_tools — county resolution and rate math.

These pin the two silent-correctness fixes:
  1. An unresolvable county must return an error the model can react to,
     never fall through to statewide numbers presented as county numbers.
  2. get_crash_rate divides by single-year denominators (population,
     drivers), so multi-year crash totals must be annualized first.
"""

from __future__ import annotations

import pytest

from app.ai_tools import get_crash_rate, get_trend, query_crashes

pytestmark = pytest.mark.integration


# ── county resolution ───────────────────────────────────────────────────


def test_query_crashes_unknown_county_returns_error_not_statewide(db_session):
    result = query_crashes(db_session, county="Los Angelos")
    assert result == [{"error": "County not found: Los Angelos"}]


def test_query_crashes_known_county_still_filters(db_session):
    # Seed: 3 LA crashes out of 5 statewide.
    result = query_crashes(db_session, county="Los Angeles")
    assert result[0]["crash_count"] == 3


def test_get_trend_unknown_county_returns_error(db_session):
    result = get_trend(db_session, metric="crash_count", county="Atlantis")
    assert result == [{"error": "County not found: Atlantis"}]


def test_get_crash_rate_unknown_county_returns_error(db_session):
    result = get_crash_rate(db_session, county="Narnia")
    assert result == {"error": "County not found: Narnia"}


# ── rate annualization ─────────────────────────────────────────────────


def test_crash_rate_annualizes_multi_year_totals(db_session):
    """Seed: LA has 3 crashes across 3 distinct years (2014, 2015, 2022)
    and population 9,861,000. The per-100k rate must use the annual
    average (1 crash/year), not the 3-crash multi-year total."""
    result = get_crash_rate(db_session, county="Los Angeles")

    assert result["total_crashes"] == 3
    assert result["years_covered"] == 3
    expected = round((3 / 3) / 9_861_000 * 100_000, 1)
    assert result["crashes_per_100k_pop"] == expected


def test_crash_rate_single_year_unchanged(db_session):
    """With an explicit single year the annualization is a no-op."""
    result = get_crash_rate(db_session, county="Los Angeles", years=[2022])

    assert result["total_crashes"] == 1
    assert result["years_covered"] == 1
    expected = round(1 / 9_861_000 * 100_000, 1)
    assert result["crashes_per_100k_pop"] == expected

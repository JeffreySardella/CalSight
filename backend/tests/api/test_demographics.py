"""Integration tests for /api/demographics."""

import pytest

from app.models import Demographic

pytestmark = pytest.mark.integration


def test_demographics_returns_seeded(client):
    response = client.get("/api/demographics")
    assert response.status_code == 200
    body = response.json()
    assert len(body) >= 2


def test_demographics_county_filter(client):
    response = client.get("/api/demographics?county=los-angeles")
    body = response.json()
    assert all(r["county_code"] == 19 for r in body)


def test_demographics_year_filter(client):
    response = client.get("/api/demographics?year=2023")
    body = response.json()
    assert all(r["year"] == 2023 for r in body)


def test_demographics_cache_header(client):
    response = client.get("/api/demographics")
    assert response.headers.get("cache-control") == "public, max-age=86400, stale-while-revalidate=604800"


# --- Regression: D-1 (per-capita denominator off by ~#years/18) -------------
#
# The choropleth sends the active date filter as ?start=&end=. The endpoint
# used to ignore those and return every seeded population-year, so the
# frontend divided a date-filtered crash count by the population summed across
# ALL years. Filtering demographics to the selected year range is the backend
# half of the fix — it makes the per-year population line up with the crash
# window so crashes_per_100k reads as an annual-average rate.


def test_demographics_start_end_filters_to_year_range(client, db_session):
    # Alameda (code 1) is seeded but has no demographics rows — add two years.
    db_session.add_all([
        Demographic(county_code=1, year=2019, population=1_600_000),
        Demographic(county_code=1, year=2023, population=1_650_000),
    ])
    db_session.flush()

    # Single-year window → only that year's row.
    resp = client.get("/api/demographics?county=alameda&start=2023-01&end=2023-12")
    assert resp.status_code == 200
    assert {r["year"] for r in resp.json()} == {2023}

    # Earlier single-year window → only 2019.
    resp = client.get("/api/demographics?county=alameda&start=2019-01&end=2019-12")
    assert {r["year"] for r in resp.json()} == {2019}

    # Range spanning both → both years (rounded outward to calendar years).
    resp = client.get("/api/demographics?county=alameda&start=2019-01&end=2023-12")
    assert {r["year"] for r in resp.json()} == {2019, 2023}


def test_demographics_no_date_filter_still_returns_all_years(client, db_session):
    # Backward compat: without year/start/end every seeded year comes back.
    db_session.add_all([
        Demographic(county_code=1, year=2019, population=1_600_000),
        Demographic(county_code=1, year=2023, population=1_650_000),
    ])
    db_session.flush()
    resp = client.get("/api/demographics?county=alameda")
    assert {r["year"] for r in resp.json()} == {2019, 2023}


def test_demographics_start_only_bounds_lower_edge(client, db_session):
    db_session.add_all([
        Demographic(county_code=1, year=2019, population=1_600_000),
        Demographic(county_code=1, year=2023, population=1_650_000),
    ])
    db_session.flush()
    # start without end → from 2020 onward, excluding 2019.
    resp = client.get("/api/demographics?county=alameda&start=2020-01")
    assert {r["year"] for r in resp.json()} == {2023}

"""Tests for /api/stats/yoy-changes and the get_yoy_changes AI tool.

Seed data (conftest) has LA crashes in 2014/2015/2022, Orange + SF in 2023 —
we insert controlled rows so the comparison years are deterministic.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import text

from app.ai_tools import TOOL_REGISTRY, get_yoy_changes
from app.models import Crash

pytestmark = pytest.mark.integration


def _crash(cid, county, year, *, severity="Injury", killed=0, injured=1):
    return Crash(
        id=cid, collision_id=cid, data_source="ccrs",
        crash_datetime=datetime(year, 6, 15, 12, 0), county_code=county,
        crash_year=year, crash_hour=12, crash_month=6, day_of_week_num=1,
        severity=severity, canonical_cause="speeding",
        number_killed=killed, number_injured=injured,
        county_name="X", latitude=34.0, longitude=-118.0,
    )


@pytest.fixture
def seed_years(db_session):
    rows = []
    cid = 9600
    # LA (19): 2 crashes in 2018 -> 5 in 2019 (+150%), small baseline (2 < 100)
    for y, n in ((2018, 2), (2019, 5)):
        for _ in range(n):
            rows.append(_crash(cid, 19, y))
            cid += 1
    # Orange (30): 4 -> 2 (-50%), also small baseline
    for y, n in ((2018, 4), (2019, 2)):
        for _ in range(n):
            rows.append(_crash(cid, 30, y))
            cid += 1
    db_session.add_all(rows)
    db_session.flush()


def test_yoy_endpoint_math_and_flags(client, seed_years):
    r = client.get("/api/stats/yoy-changes?metric=crashes&year=2019")
    assert r.status_code == 200
    body = r.json()
    assert body["year"] == 2019
    assert body["baseline_year"] == 2018
    assert body["partial_year"] is False
    assert body["min_baseline"] == 100

    by_code = {row["county_code"]: row for row in body["rows"]}
    la = by_code[19]
    assert (la["previous"], la["current"], la["abs_change"]) == (2, 5, 3)
    assert la["pct_change"] == 150.0
    assert la["small_baseline"] is True  # baseline 2 < 100

    orange = by_code[30]
    assert orange["pct_change"] == -50.0


def test_yoy_default_year_is_latest(client, seed_years):
    # Seed's latest crash_year is 2023 (conftest) — default should pick it up.
    r = client.get("/api/stats/yoy-changes?metric=crashes")
    assert r.json()["year"] == 2023


def test_yoy_solid_baseline_ranks_before_small(client, db_session):
    """A county with a solid baseline ranks before small-baseline rows even
    when its percent change is smaller."""
    rows = []
    cid = 9700
    # SF (38): 120 -> 150 (+25%), solid baseline (120 >= 100)
    for y, n in ((2011, 120), (2012, 150)):
        for _ in range(n):
            rows.append(_crash(cid, 38, y))
            cid += 1
    # LA (19): 1 -> 3 (+200%), small baseline
    for y, n in ((2011, 1), (2012, 3)):
        for _ in range(n):
            rows.append(_crash(cid, 19, y))
            cid += 1
    db_session.add_all(rows)
    db_session.flush()

    body = client.get("/api/stats/yoy-changes?metric=crashes&year=2012").json()
    codes = [row["county_code"] for row in body["rows"]]
    assert codes.index(38) < codes.index(19)


def test_yoy_default_skips_barely_loaded_trailing_year(client, db_session):
    """A trailing year holding only a sliver of rows (upstream ingest lag) must
    not be the default comparison year — it would rank every county at -100%."""
    rows = []
    cid = 9800
    for y, n in ((2024, 50), (2025, 2)):
        for _ in range(n):
            rows.append(_crash(cid, 19, y))
            cid += 1
    db_session.add_all(rows)
    db_session.flush()
    # _default_year is sourced from mv_crashes_by_year (P-2), so make the MV
    # reflect the seeded years before asking for the default. A plain (non-
    # CONCURRENT) REFRESH in this transaction sees the flushed rows.
    db_session.execute(text("REFRESH MATERIALIZED VIEW mv_crashes_by_year"))

    body = client.get("/api/stats/yoy-changes?metric=crashes").json()
    assert body["year"] == 2024
    assert body["partial_year"] is False

    # An explicit request for the sliver year is still honored.
    body = client.get("/api/stats/yoy-changes?metric=crashes&year=2025").json()
    assert body["year"] == 2025


def test_yoy_default_never_selects_the_current_calendar_year(client, db_session):
    """Regression: the public "biggest year-over-year changes" panel used to
    default to the in-progress calendar year and rank a few months of data
    against a full prior year, fabricating -50% to -64% declines for every
    county. The current year must never be chosen as the default, no matter how
    many rows it holds — it is partial by definition.
    """
    current_year = datetime.now(timezone.utc).year
    rows = []
    cid = 9700
    # Give the current year MORE rows than the prior complete year, so only the
    # calendar-year rule (not the coverage ratio) can exclude it.
    for y, n in ((current_year - 1, 40), (current_year, 120)):
        for _ in range(n):
            rows.append(_crash(cid, 19, y))
            cid += 1
    db_session.add_all(rows)
    db_session.flush()
    db_session.execute(text("REFRESH MATERIALIZED VIEW mv_crashes_by_year"))

    body = client.get("/api/stats/yoy-changes?metric=crashes").json()
    assert body["year"] == current_year - 1, "defaulted to the in-progress year"
    assert body["partial_year"] is False

    # Explicit opt-in still works, and is honestly flagged.
    body = client.get(f"/api/stats/yoy-changes?metric=crashes&year={current_year}").json()
    assert body["year"] == current_year
    assert body["partial_year"] is True


def test_yoy_default_year_reads_from_matview(client, db_session):
    """_default_year routes off mv_crashes_by_year, not a full GROUP BY over the
    11M-row crashes table: a live-table row in a brand-new max year is ignored
    until the MV is refreshed, then honored."""
    rows = [_crash(9900 + i, 19, 2025) for i in range(200)]
    db_session.add_all(rows)
    db_session.flush()

    # MV not yet refreshed — default stays at the MV's latest (2023 from seed),
    # proving the year is read from the MV rather than the live table.
    assert client.get("/api/stats/yoy-changes?metric=crashes").json()["year"] == 2023

    db_session.execute(text("REFRESH MATERIALIZED VIEW mv_crashes_by_year"))
    body = client.get("/api/stats/yoy-changes?metric=crashes").json()
    assert body["year"] == 2025
    # Per-county numbers still come from the live table: 2025 has the 200 rows.
    assert body["rows"][0]["current"] == 200


def test_yoy_ai_tool(db_session, seed_years):
    assert "get_yoy_changes" in TOOL_REGISTRY
    out = get_yoy_changes(db_session, metric="crashes", year=2019, limit=5)
    assert out["year"] == 2019
    assert len(out["rows"]) <= 5
    assert out["rows"][0]["pct_change"] is not None


def test_yoy_ai_tool_rejects_bad_metric(db_session):
    out = get_yoy_changes(db_session, metric="vibes")
    assert "error" in out

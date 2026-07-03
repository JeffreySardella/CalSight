"""Tests for /api/stats/yoy-changes and the get_yoy_changes AI tool.

Seed data (conftest) has LA crashes in 2014/2015/2022, Orange + SF in 2023 —
we insert controlled rows so the comparison years are deterministic.
"""

from __future__ import annotations

from datetime import datetime

import pytest

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


def test_yoy_ai_tool(db_session, seed_years):
    assert "get_yoy_changes" in TOOL_REGISTRY
    out = get_yoy_changes(db_session, metric="crashes", year=2019, limit=5)
    assert out["year"] == 2019
    assert len(out["rows"]) <= 5
    assert out["rows"][0]["pct_change"] is not None


def test_yoy_ai_tool_rejects_bad_metric(db_session):
    out = get_yoy_changes(db_session, metric="vibes")
    assert "error" in out

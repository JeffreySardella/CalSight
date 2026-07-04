"""Integration tests for /api/intersections and /api/corridors.

Insert road-pair crashes into the shared transactional session (the `client`
fixture yields the same `db_session`), then exercise the aggregation.
"""

from __future__ import annotations

from datetime import datetime

import pytest

from app.models import Crash
from app.routers.intersections import clear_concentration_cache

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def _fresh_concentration_cache():
    """Concentration results are cached in-process; tests seed different data
    into the same app, so every test starts (and leaves) with a cold cache."""
    clear_concentration_cache()
    yield
    clear_concentration_cache()


def _crash(cid, primary, secondary, *, severity="Injury", killed=0, injured=1,
           county=19, year=2022, lat=34.0, lon=-118.0,
           pedestrian=False, cyclist=False):
    return Crash(
        id=cid, collision_id=cid, data_source="ccrs",
        crash_datetime=datetime(year, 3, 10, 12, 0), county_code=county,
        crash_year=year, crash_hour=12, crash_month=3, day_of_week_num=1,
        severity=severity, canonical_cause="speeding",
        number_killed=killed, number_injured=injured,
        county_name="Los Angeles", latitude=lat, longitude=lon,
        primary_road=primary, secondary_road=secondary,
        pedestrian_involved=pedestrian, cyclist_involved=cyclist,
    )


@pytest.fixture
def seed_intersections(db_session):
    rows = [
        # MAIN ST x OAK AVE: 3 crashes (1 fatal, 2 injury)
        _crash(9001, "MAIN ST", "OAK AVE", severity="Fatal", killed=1, injured=0),
        _crash(9002, "main st", "oak ave", severity="Injury", injured=2),   # normalization
        _crash(9003, "MAIN  ST", " OAK AVE ", severity="Injury", injured=1),  # whitespace
        # 1ST ST x ELM AVE: 2 crashes
        _crash(9004, "1ST ST", "ELM AVE", severity="Property Damage Only", injured=0),
        _crash(9005, "1ST ST", "ELM AVE", severity="Injury", injured=1),
        # A corridor-only crash (no secondary road) on MAIN ST
        _crash(9006, "MAIN ST", None, severity="Injury", injured=1),
        _crash(9007, "MAIN ST", "", severity="Injury", injured=1),
    ]
    db_session.add_all(rows)
    db_session.flush()
    return rows


def test_intersections_ranked_by_count(client, seed_intersections):
    r = client.get("/api/intersections?county=los-angeles&min_crashes=1")
    assert r.status_code == 200
    body = r.json()
    # Two intersections; MAIN x OAK (3) ranks above 1ST x ELM (2).
    assert len(body) == 2
    top = body[0]
    assert top["primary_road"] == "MAIN ST"
    assert top["secondary_road"] == "OAK AVE"
    assert top["crash_count"] == 3           # normalization merged the 3
    assert top["fatal_count"] == 1
    assert top["injury_count"] == 2
    assert top["killed"] == 1
    assert body[1]["crash_count"] == 2


def test_intersections_require_two_roads(client, seed_intersections):
    """Crashes with a null/blank secondary road are corridor-only, never an
    intersection — so MAIN ST's count as an intersection is 3, not 5."""
    r = client.get("/api/intersections?county=los-angeles&min_crashes=1")
    main = next(x for x in r.json() if x["primary_road"] == "MAIN ST")
    assert main["crash_count"] == 3


def test_min_crashes_filter(client, seed_intersections):
    r = client.get("/api/intersections?county=los-angeles&min_crashes=3")
    body = r.json()
    assert [x["primary_road"] for x in body] == ["MAIN ST"]  # only the 3-crash one


def test_corridors_group_by_primary(client, seed_intersections):
    r = client.get("/api/corridors?county=los-angeles&min_crashes=1")
    assert r.status_code == 200
    body = r.json()
    main = next(x for x in body if x["primary_road"] == "MAIN ST")
    # All 5 MAIN ST crashes (3 intersection + 2 corridor-only) roll up here.
    assert main["crash_count"] == 5
    assert main["secondary_road"] is None


def test_unknown_county_404(client):
    r = client.get("/api/intersections?county=atlantis")
    assert r.status_code == 404


def test_severity_score_and_sort(client, db_session):
    """severity=fatal*100+injury*10+pdo*1; sort=severity ranks by it, so a
    low-count-but-fatal intersection can outrank a high-count-but-minor one."""
    db_session.add_all([
        # HIGH ST x A: many minor crashes (10 PDO) -> count 10, score 10
        *[_crash(9300 + i, "HIGH ST", "A AVE", severity="Property Damage Only", injured=0)
          for i in range(10)],
        # FATAL ST x B: 2 crashes, both fatal -> count 2, score 200
        _crash(9350, "FATAL ST", "B AVE", severity="Fatal", killed=1, injured=0),
        _crash(9351, "FATAL ST", "B AVE", severity="Fatal", killed=1, injured=0),
    ])
    db_session.flush()

    by_count = client.get("/api/intersections?county=los-angeles&min_crashes=1&sort=count").json()
    assert by_count[0]["primary_road"] == "HIGH ST"      # 10 > 2 by count
    assert by_count[0]["severity_score"] == 10

    by_sev = client.get("/api/intersections?county=los-angeles&min_crashes=1&sort=severity").json()
    assert by_sev[0]["primary_road"] == "FATAL ST"       # 200 > 10 by severity
    assert by_sev[0]["severity_score"] == 200


def test_street_concentration(client, db_session):
    """10 corridors: one 'CONC ST' holds all 5 fatal+injury crashes; the other
    9 have PDO-only. Top 10% of streets (=1 street) should hold 100% of severe
    crashes."""
    rows = []
    cid = 9400
    # 1 severe-heavy corridor: 5 injury crashes
    for _ in range(5):
        rows.append(_crash(cid, "CONC ST", f"X{cid} AVE", severity="Injury", injured=1))
        cid += 1
    # 9 PDO-only corridors (no severe)
    for j in range(9):
        rows.append(_crash(cid, f"MINOR{j} ST", "Y AVE", severity="Property Damage Only", injured=0))
        cid += 1
    db_session.add_all(rows)
    db_session.flush()

    r = client.get("/api/street-concentration?county=los-angeles&scope=corridors")
    assert r.status_code == 200
    body = r.json()
    assert body["total_units"] == 10           # 10 distinct corridors
    assert body["total_severe_crashes"] == 5   # only CONC ST's 5 injuries
    top10 = next(b for b in body["breakpoints"] if b["top_pct"] == 10)
    assert top10["unit_count"] == 1            # ceil(10 * 0.10) = 1
    assert top10["severe_share_pct"] == 100.0  # that 1 street holds all severe


def test_street_concentration_cached_until_cleared(client, db_session):
    """A repeat call within the TTL returns the cached result even after new
    rows land; clearing the cache picks the new rows up. (The heavy statewide
    scan must run at most once per TTL window, not once per visitor.)"""
    cid = 9500
    db_session.add(_crash(cid, "CACHE ST", "HIT AVE", severity="Injury", injured=1))
    db_session.flush()

    url = "/api/street-concentration?county=los-angeles&scope=corridors"
    assert client.get(url).json()["total_units"] == 1

    db_session.add(_crash(cid + 1, "NEW ST", "MISS AVE", severity="Injury", injured=1))
    db_session.flush()
    assert client.get(url).json()["total_units"] == 1  # cached

    clear_concentration_cache()
    assert client.get(url).json()["total_units"] == 2  # recomputed


def test_pedestrian_mode_filter(client, db_session):
    """A pedestrian filter restricts to pedestrian-involved crashes only."""
    db_session.add_all([
        _crash(9201, "PED ST", "CROSS AVE", pedestrian=True),
        _crash(9202, "PED ST", "CROSS AVE", pedestrian=True),
        _crash(9203, "CAR ST", "AUTO AVE", pedestrian=False),
    ])
    db_session.flush()
    r = client.get("/api/intersections?county=los-angeles&min_crashes=1&pedestrian=true")
    body = r.json()
    assert [x["primary_road"] for x in body] == ["PED ST"]
    assert body[0]["crash_count"] == 2


def test_centroid_coordinates_present(client, seed_intersections):
    r = client.get("/api/intersections?county=los-angeles&min_crashes=1")
    top = r.json()[0]
    assert top["latitude"] is not None
    assert top["longitude"] is not None

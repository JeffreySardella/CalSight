"""Integration tests for /api/intersections and /api/corridors.

Insert road-pair crashes into the shared transactional session (the `client`
fixture yields the same `db_session`), then exercise the aggregation.
"""

from __future__ import annotations

from datetime import datetime

import pytest

from app.models import Crash

pytestmark = pytest.mark.integration


def _crash(cid, primary, secondary, *, severity="Injury", killed=0, injured=1,
           county=19, year=2022, lat=34.0, lon=-118.0):
    return Crash(
        id=cid, collision_id=cid, data_source="ccrs",
        crash_datetime=datetime(year, 3, 10, 12, 0), county_code=county,
        crash_year=year, crash_hour=12, crash_month=3, day_of_week_num=1,
        severity=severity, canonical_cause="speeding",
        number_killed=killed, number_injured=injured,
        county_name="Los Angeles", latitude=lat, longitude=lon,
        primary_road=primary, secondary_road=secondary,
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


def test_centroid_coordinates_present(client, seed_intersections):
    r = client.get("/api/intersections?county=los-angeles&min_crashes=1")
    top = r.json()[0]
    assert top["latitude"] is not None
    assert top["longitude"] is not None

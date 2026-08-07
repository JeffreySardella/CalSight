"""The matview fast path must agree exactly with the raw-crashes query.

/api/intersections and /api/corridors read mv_street_aggregates (migration
a5b6c7d8e9f0) when it is populated, and fall back to scanning the crashes
table when it isn't. Two code paths producing "roughly the same" numbers
would be worse than one slow path, so these tests assert the two agree
row-for-row across the filter matrix — including the parts most likely to
drift: road-name normalization, the ''/0 sentinels standing in for NULL,
and the lat/lon means, which are re-derived from stored sums rather than
averaged twice.
"""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import text

from app.models import Crash
from app.routers.intersections import _aggregate, _aggregate_from_mv

pytestmark = pytest.mark.integration


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
def seeded_and_refreshed(db_session):
    """Seed a spread of awkward cases, then populate the matview from them."""
    db_session.add_all([
        # Normalization: case and internal whitespace must collapse together.
        _crash(9101, "MAIN ST", "OAK AVE", severity="Fatal", killed=2, injured=0, lat=34.00, lon=-118.00),
        _crash(9102, "main st", "oak ave", severity="Injury", injured=3, lat=34.10, lon=-118.10),
        _crash(9103, "MAIN  ST", " OAK AVE ", severity="Property Damage Only", injured=0, lat=34.20, lon=-118.20),
        # Corridor-only rows: NULL and blank secondary road.
        _crash(9104, "MAIN ST", None, severity="Injury", injured=1),
        _crash(9105, "MAIN ST", "", severity="Injury", injured=1),
        # A second county, so county scoping is exercised.
        _crash(9106, "MAIN ST", "OAK AVE", county=37, severity="Injury", injured=1),
        # Different years, for the year-bound filters.
        _crash(9107, "1ST ST", "ELM AVE", year=2019, severity="Injury", injured=1),
        _crash(9108, "1ST ST", "ELM AVE", year=2023, severity="Fatal", killed=1),
        # Involvement flags, including NULL cyclist_involved.
        _crash(9109, "PINE RD", "CEDAR LN", pedestrian=True, severity="Injury", injured=1),
        _crash(9110, "PINE RD", "CEDAR LN", cyclist=True, severity="Injury", injured=1),
        _crash(9111, "PINE RD", "CEDAR LN", cyclist=None, severity="Injury", injured=1),
        # Missing coordinates must not skew the mean.
        _crash(9112, "PINE RD", "CEDAR LN", lat=None, lon=None, severity="Injury", injured=1),
        # Unknown crash_year -> stored as the 0 sentinel in the view.
        _crash(9113, "ELMWOOD DR", "BIRCH ST", year=2021, severity="Injury", injured=1),
    ])
    db_session.flush()
    # Non-concurrent refresh: CONCURRENTLY is illegal inside a transaction,
    # and the test session is transactional.
    db_session.execute(text("REFRESH MATERIALIZED VIEW mv_street_aggregates"))
    return db_session


# Every combination worth distinguishing between the two paths.
CASES = [
    pytest.param({}, id="statewide-corridors-unfiltered"),
    pytest.param({"by_secondary": True}, id="statewide-intersections"),
    pytest.param({"county_code": 19}, id="county-scoped"),
    pytest.param({"by_secondary": True, "county_code": 19}, id="county-intersections"),
    pytest.param({"year_start": 2020}, id="year-lower-bound"),
    pytest.param({"year_end": 2020}, id="year-upper-bound"),
    pytest.param({"year_start": 2019, "year_end": 2023}, id="year-range"),
    pytest.param({"pedestrian": True}, id="pedestrian-only"),
    pytest.param({"cyclist": True}, id="cyclist-only"),
    pytest.param({"cyclist": False}, id="cyclist-excluded"),
    pytest.param({"sort": "severity"}, id="severity-sort"),
    pytest.param({"by_secondary": True, "sort": "severity"}, id="intersections-severity-sort"),
    pytest.param({"min_crashes": 3}, id="min-crashes-threshold"),
    pytest.param({"limit": 2}, id="limit"),
]


def _call(fn, session, overrides):
    kwargs = {
        "by_secondary": False,
        "county_code": None,
        "year_start": None,
        "year_end": None,
        "min_crashes": 1,
        "limit": 25,
        "pedestrian": None,
        "cyclist": None,
        "sort": "count",
    }
    kwargs.update(overrides)
    return fn(session, **kwargs)


def _comparable(rows):
    """Rounded tuples — float means must match to a sane precision, not bitwise."""
    return [
        (
            r.county_code, r.primary_road, r.secondary_road, r.crash_count,
            r.fatal_count, r.injury_count, r.pdo_count, r.severity_score,
            r.killed, r.injured,
            None if r.latitude is None else round(r.latitude, 9),
            None if r.longitude is None else round(r.longitude, 9),
        )
        for r in rows
    ]


@pytest.mark.parametrize("overrides", CASES)
def test_matview_matches_raw_query(seeded_and_refreshed, overrides):
    session = seeded_and_refreshed
    raw = _call(_aggregate, session, overrides)
    mv = _call(_aggregate_from_mv, session, overrides)

    assert _comparable(mv) == _comparable(raw), (
        f"matview and raw query disagree for {overrides}"
    )


def test_matview_actually_returns_data(seeded_and_refreshed):
    """Guard against the equality tests passing because both sides are empty."""
    rows = _call(_aggregate_from_mv, seeded_and_refreshed, {"by_secondary": True})
    assert rows, "expected intersections in the seeded data"
    assert any(r.primary_road == "MAIN ST" for r in rows)


def test_normalization_merges_case_and_whitespace(seeded_and_refreshed):
    rows = _call(_aggregate_from_mv, seeded_and_refreshed,
                 {"by_secondary": True, "county_code": 19})
    main = next(r for r in rows if r.primary_road == "MAIN ST")
    # "MAIN ST"/"main st"/"MAIN  ST" x "OAK AVE"/"oak ave"/" OAK AVE " -> one row.
    assert main.secondary_road == "OAK AVE"
    assert main.crash_count == 3
    assert main.fatal_count == 1
    assert main.killed == 2


def test_corridor_counts_include_rows_without_a_secondary_road(seeded_and_refreshed):
    """MAIN ST as a corridor covers the 3 intersection crashes plus the NULL
    and blank secondary-road rows; as an intersection it is only the 3."""
    corridors = _call(_aggregate_from_mv, seeded_and_refreshed, {"county_code": 19})
    intersections = _call(_aggregate_from_mv, seeded_and_refreshed,
                          {"by_secondary": True, "county_code": 19})

    assert next(r for r in corridors if r.primary_road == "MAIN ST").crash_count == 5
    assert next(r for r in intersections if r.primary_road == "MAIN ST").crash_count == 3


def test_coordinate_mean_ignores_missing_coordinates(seeded_and_refreshed):
    """Re-derived from sums: a NULL-coordinate crash must not drag the mean
    toward zero, and must not be counted in the denominator."""
    rows = _call(_aggregate_from_mv, seeded_and_refreshed,
                 {"by_secondary": True, "county_code": 19})
    pine = next(r for r in rows if r.primary_road == "PINE RD")
    # Four crashes, three with coordinates, all at 34.0/-118.0.
    assert pine.crash_count == 4
    assert pine.latitude == pytest.approx(34.0)
    assert pine.longitude == pytest.approx(-118.0)

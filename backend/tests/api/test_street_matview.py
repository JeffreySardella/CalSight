"""The matview fast path must agree exactly with the raw-crashes query.

/api/intersections and /api/corridors read mv_street_aggregates (migration
c4f1a9b2d3e7) when it is populated, and fall back to scanning the crashes
table when it isn't. Two code paths producing "roughly the same" numbers
would be worse than one slow path, so these tests assert the two agree
row-for-row across the filter matrix — including the parts most likely to
drift: road-name normalization, the ''/0 sentinels standing in for NULL,
and the lat/lon means, which are re-derived from stored sums rather than
averaged twice.
"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import patch

import pytest
from sqlalchemy import text

import app.routers.intersections as intersections_mod
from app.models import Crash
from app.routers.intersections import (
    _aggregate,
    _aggregate_from_mv,
    _aggregate_from_totals,
    _concentration,
    clear_aggregate_cache,
    clear_concentration_cache,
    reset_mv_populated_cache,
)

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
        # A second county, so county scoping is exercised. Must be one of the
        # counties conftest seeds (1, 19, 30, 34, 38) — crashes.county_code is
        # a foreign key into counties.
        _crash(9106, "MAIN ST", "OAK AVE", county=30, severity="Injury", injured=1),
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
    db_session.execute(text("REFRESH MATERIALIZED VIEW mv_street_totals"))
    return db_session


@pytest.fixture(autouse=True)
def _cold_caches():
    """Results and the populated-probe are cached in-process; the probe
    especially must not leak a True from this module (where the views are
    populated inside a rolled-back transaction) into the next one."""
    clear_aggregate_cache()
    clear_concentration_cache()
    reset_mv_populated_cache()
    yield
    clear_aggregate_cache()
    clear_concentration_cache()
    reset_mv_populated_cache()


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
    """Rounded tuples — float means must match to a sane precision, not bitwise.

    Sorted, because row order among ties is unspecified: both queries end with
    `ORDER BY <count|score> DESC, fatal_count DESC`, and rows tied on both keys
    may come back in either order from either plan. Ordering is asserted
    separately, on the keys that actually are deterministic.
    """
    return sorted(
        (
            r.county_code, r.primary_road, r.secondary_road, r.crash_count,
            r.fatal_count, r.injury_count, r.pdo_count, r.severity_score,
            r.killed, r.injured,
            None if r.latitude is None else round(r.latitude, 9),
            None if r.longitude is None else round(r.longitude, 9),
        )
        for r in rows
    )


def _sort_keys(rows, sort):
    """The ordering keys, in returned order — deterministic even across ties."""
    if sort == "severity":
        return [(r.severity_score, r.fatal_count) for r in rows]
    return [(r.crash_count, r.fatal_count) for r in rows]


@pytest.mark.parametrize("overrides", CASES)
def test_matview_matches_raw_query(seeded_and_refreshed, overrides):
    session = seeded_and_refreshed
    raw = _call(_aggregate, session, overrides)
    mv = _call(_aggregate_from_mv, session, overrides)

    assert _comparable(mv) == _comparable(raw), (
        f"matview and raw query disagree for {overrides}"
    )


@pytest.mark.parametrize("overrides", CASES)
def test_matview_orders_results_the_same_way(seeded_and_refreshed, overrides):
    """Same ranking, and actually ranked — a top-N list in the wrong order is
    wrong even when the set of rows is right."""
    session = seeded_and_refreshed
    sort = overrides.get("sort", "count")
    raw_keys = _sort_keys(_call(_aggregate, session, overrides), sort)
    mv_keys = _sort_keys(_call(_aggregate_from_mv, session, overrides), sort)

    assert mv_keys == raw_keys, f"ranking differs for {overrides}"
    assert mv_keys == sorted(mv_keys, reverse=True), "results are not ranked descending"


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


def test_unknown_involvement_is_excluded_by_both_true_and_false_filters(
    seeded_and_refreshed,
):
    """NULL cyclist_involved is 'unknown', not 'no'.

    Regression: the view first stored COALESCE(cyclist_involved, false), which
    swept unknown crashes into every ?cyclist=false result. The endpoints
    filter with IS TRUE / IS FALSE, and NULL satisfies neither, so the view
    keeps a three-valued sentinel instead.

    PINE RD has 4 crashes: one cyclist=true, two cyclist=false, one NULL.
    """
    session = seeded_and_refreshed
    scope = {"by_secondary": True, "county_code": 19}

    def pine(overrides):
        rows = _call(_aggregate_from_mv, session, {**scope, **overrides})
        row = next((r for r in rows if r.primary_road == "PINE RD"), None)
        return row.crash_count if row else 0

    assert pine({}) == 4
    assert pine({"cyclist": True}) == 1
    assert pine({"cyclist": False}) == 2, "the NULL-cyclist crash must not count as false"
    # And the total across true/false is short of the unfiltered count by
    # exactly the unknown row — the invariant that makes the point.
    assert pine({"cyclist": True}) + pine({"cyclist": False}) == pine({}) - 1


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


# ── mv_street_totals (migration 77b8d6739669) ─────────────────────────────
#
# The coarse view has no year / involvement axis, so it is only asked the
# cases without those filters — exactly the ones _cached_aggregate routes to
# it. Same bar as above: row-for-row agreement with the raw query.

_COARSE_KEYS = {"by_secondary", "county_code", "min_crashes", "limit", "sort"}
TOTALS_CASES = [c for c in CASES if set(c.values[0]) <= _COARSE_KEYS]


def _call_totals(session, overrides):
    kwargs = {"by_secondary": False, "county_code": None, "min_crashes": 1,
              "limit": 25, "sort": "count"}
    kwargs.update(overrides)
    return _aggregate_from_totals(session, **kwargs)


@pytest.mark.parametrize("overrides", TOTALS_CASES)
def test_totals_view_matches_raw_query(seeded_and_refreshed, overrides):
    session = seeded_and_refreshed
    raw = _call(_aggregate, session, overrides)
    totals = _call_totals(session, overrides)

    assert _comparable(totals) == _comparable(raw), (
        f"totals view and raw query disagree for {overrides}"
    )
    sort = overrides.get("sort", "count")
    assert _sort_keys(totals, sort) == _sort_keys(raw, sort)


def test_totals_cases_cover_both_scopes_and_sorts():
    """Guard against the filter above silently emptying the matrix."""
    ids = {c.id for c in TOTALS_CASES}
    assert {"statewide-corridors-unfiltered", "statewide-intersections",
            "county-scoped", "severity-sort", "limit"} <= ids


def _concentration_via(populated, session, **overrides):
    kwargs = {"by_secondary": False, "county_code": None, "county_name": None,
              "year_start": None, "year_end": None}
    kwargs.update(overrides)
    clear_concentration_cache()
    with patch.object(intersections_mod, "_mv_populated", return_value=populated):
        return _concentration(session, **kwargs).model_dump()


@pytest.mark.parametrize("by_secondary", [False, True], ids=["corridors", "intersections"])
@pytest.mark.parametrize("county_code", [None, 19], ids=["statewide", "county"])
def test_concentration_from_totals_matches_live(seeded_and_refreshed, by_secondary, county_code):
    """Statewide, the live query groups by road NAME across counties (MAIN ST
    in LA and Orange is one unit) — the totals view must reproduce that, not
    the per-county grain."""
    session = seeded_and_refreshed
    live = _concentration_via(False, session, by_secondary=by_secondary, county_code=county_code)
    totals = _concentration_via(True, session, by_secondary=by_secondary, county_code=county_code)
    assert totals == live
    assert totals["total_units"] > 0


@pytest.mark.parametrize(
    "path, fn",
    [
        ("/api/intersections?min_crashes=1", "_aggregate_from_totals"),
        ("/api/corridors?min_crashes=1", "_aggregate_from_totals"),
        ("/api/street-concentration", "_concentration_units"),
    ],
)
def test_statewide_endpoint_reads_totals_view_and_matches_live(
    client, seeded_and_refreshed, path, fn,
):
    """No county selected: the endpoint reads mv_street_totals when populated,
    and the JSON matches what the live query returns — same rows, same
    ranking. Two allowances, both already made by the fine-view tests above:
    coordinate means are floating-point sums taken in a different scan order
    (compared to 9 places), and rows tied on both ORDER BY keys may come back
    in either order (compared as a set, with the ranking keys checked in
    sequence)."""
    with (
        patch.object(intersections_mod, "_mv_populated", return_value=True),
        patch.object(intersections_mod, fn, wraps=getattr(intersections_mod, fn)) as spy,
    ):
        fast = client.get(path)
        assert fast.status_code == 200
        assert spy.call_count == 1
    clear_aggregate_cache()
    clear_concentration_cache()
    with patch.object(intersections_mod, "_mv_populated", return_value=False):
        live = client.get(path)

    fast_body, live_body = fast.json(), live.json()
    assert fast_body, "expected data in the seeded set"
    if not isinstance(fast_body, list):  # street-concentration: one object
        assert fast_body == live_body
        return

    def _rows(body):
        return sorted(
            (
                {**row, **{k: None if row[k] is None else round(row[k], 9)
                           for k in ("latitude", "longitude")}}
                for row in body
            ),
            key=lambda r: (r["county_code"], r["primary_road"], r["secondary_road"] or ""),
        )

    assert _rows(fast_body) == _rows(live_body)
    assert [(r["crash_count"], r["fatal_count"]) for r in fast_body] == \
        [(r["crash_count"], r["fatal_count"]) for r in live_body]

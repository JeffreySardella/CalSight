"""Unit tests for the tract point-in-polygon aggregate (no DB, no network).

The fixture is two unit-square "tracts" sharing an edge, so which crash lands
where is checkable by eye rather than by trusting the join. shapely is a
pinned runtime dependency, so there is nothing to skip on.
"""

from shapely.geometry import box

from etl.compute_tract_crashes import (
    CrashPoint,
    TractIndex,
    aggregate_crashes_to_tracts,
    build_tract_index,
)

import shapely

WEST = "06001000001"
EAST = "06001000002"


def _tracts() -> TractIndex:
    """Two adjacent 1x1-degree squares: WEST (lon 0..1) and EAST (lon 1..2)."""
    geoms = [box(0, 0, 1, 1), box(1, 0, 2, 1)]
    return TractIndex(geoids=[WEST, EAST], tree=shapely.STRtree(geoms))


def _crash(lat, lon, year=2023, killed=0, injured=0) -> CrashPoint:
    return CrashPoint(lat, lon, year, killed, injured)


def _by_geoid(rows):
    return {r["geoid"]: r for r in rows}


def test_assigns_each_crash_to_the_tract_containing_it():
    rows = aggregate_crashes_to_tracts(
        [
            _crash(0.5, 0.5, killed=1, injured=2),   # west
            _crash(0.2, 0.9, injured=1),             # west
            _crash(0.5, 1.5, killed=3),              # east
        ],
        _tracts(),
    )
    got = _by_geoid(rows)
    assert (got[WEST]["crash_count"], got[WEST]["killed"], got[WEST]["injured"]) == (2, 1, 3)
    assert (got[EAST]["crash_count"], got[EAST]["killed"], got[EAST]["injured"]) == (1, 3, 0)


def test_splits_by_year():
    rows = aggregate_crashes_to_tracts(
        [_crash(0.5, 0.5, year=2022, injured=1), _crash(0.5, 0.5, year=2023, killed=1)],
        _tracts(),
    )
    assert len(rows) == 2
    assert {r["year"] for r in rows} == {2022, 2023}
    assert [r["crash_count"] for r in rows] == [1, 1]


def test_drops_crashes_outside_every_tract():
    """Bad or out-of-state coordinates fall out of the join, not into a tract."""
    rows = aggregate_crashes_to_tracts(
        [
            _crash(0.5, 0.5),                    # inside WEST
            _crash(50.0, -120.0, killed=9, injured=9),  # nowhere near either square
            _crash(0.5, 7.0, killed=9, injured=9),      # east of both
        ],
        _tracts(),
    )
    assert len(rows) == 1
    assert rows[0]["geoid"] == WEST
    assert rows[0]["crash_count"] == 1
    # The dropped rows carried 18 deaths; none may leak into a tract.
    assert rows[0]["killed"] == 0


def test_drops_a_crash_exactly_on_a_shared_boundary():
    """`within` is interior-only, so a boundary point matches neither square.

    That is the deliberate, safe direction: an `intersects` join would count
    the same crash in both neighbours. Documented in the aggregate's docstring.
    """
    rows = aggregate_crashes_to_tracts(
        [
            _crash(0.5, 1.0, killed=7),   # exactly on the WEST/EAST edge
            _crash(0.5, 0.5),             # interior control, so the test can fail loudly
        ],
        _tracts(),
    )
    assert len(rows) == 1
    assert rows[0]["geoid"] == WEST
    assert rows[0]["crash_count"] == 1
    assert rows[0]["killed"] == 0


def test_a_point_in_overlapping_tracts_is_counted_once():
    """Generalised boundaries can overlap by a hair; first match wins."""
    overlapping = TractIndex(
        geoids=[WEST, EAST],
        tree=shapely.STRtree([box(0, 0, 1.5, 1), box(0.5, 0, 2, 1)]),
    )
    rows = aggregate_crashes_to_tracts([_crash(0.5, 1.0, killed=1)], overlapping)
    assert sum(r["crash_count"] for r in rows) == 1
    assert sum(r["killed"] for r in rows) == 1


def test_empty_input_returns_no_rows():
    assert aggregate_crashes_to_tracts([], _tracts()) == []


def test_counts_are_plain_ints():
    """The DB columns are INTEGER; a numpy scalar would not adapt in psycopg2."""
    row = aggregate_crashes_to_tracts([_crash(0.5, 0.5, killed=1, injured=2)], _tracts())[0]
    for key in ("year", "crash_count", "killed", "injured"):
        assert type(row[key]) is int, f"{key} is {type(row[key])}"
    assert type(row["geoid"]) is str


class TestBuildTractIndex:
    FEATURES = [
        {
            "properties": {"GEOID": WEST},
            "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]},
        },
        {
            "properties": {"GEOID": EAST},
            "geometry": {"type": "Polygon", "coordinates": [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]]},
        },
    ]

    def test_keeps_geoids_aligned_with_the_tree(self):
        index = build_tract_index(self.FEATURES)
        assert index.geoids == [WEST, EAST]
        rows = aggregate_crashes_to_tracts([_crash(0.5, 1.5)], index)
        assert rows[0]["geoid"] == EAST

    def test_skips_features_missing_a_geoid_or_geometry(self):
        index = build_tract_index([
            *self.FEATURES,
            {"properties": {}, "geometry": self.FEATURES[0]["geometry"]},
            {"properties": {"GEOID": "06001000003"}, "geometry": None},
        ])
        assert index.geoids == [WEST, EAST]

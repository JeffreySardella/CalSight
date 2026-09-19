"""Unit tests for the tract point-in-polygon aggregate (no DB, no network).

The fixture is two unit-square "tracts" side by side, so which crash lands
where is checkable by eye rather than by trusting the join.
"""

import pandas as pd
import pytest

from etl.compute_tract_crashes import aggregate_crashes_to_tracts

gpd = pytest.importorskip("geopandas")
shapely_geometry = pytest.importorskip("shapely.geometry")


def _tracts():
    """Two adjacent 1x1-degree squares: WEST (0..1) and EAST (1..2)."""
    box = shapely_geometry.box
    return gpd.GeoDataFrame(
        {"geoid": ["06001000001", "06001000002"]},
        geometry=[box(0, 0, 1, 1), box(1, 0, 2, 1)],
        crs="EPSG:4326",
    )


def _crashes(rows):
    return pd.DataFrame(
        rows,
        columns=[
            "latitude", "longitude", "crash_year",
            "number_killed", "number_injured",
        ],
    )


def test_assigns_each_crash_to_the_tract_containing_it():
    crashes = _crashes([
        (0.5, 0.5, 2023, 1, 2),   # west
        (0.2, 0.9, 2023, 0, 1),   # west
        (0.5, 1.5, 2023, 3, 0),   # east
    ])
    out = aggregate_crashes_to_tracts(crashes, _tracts())

    west = out[out.geoid == "06001000001"].iloc[0]
    east = out[out.geoid == "06001000002"].iloc[0]
    assert (west.crash_count, west.killed, west.injured) == (2, 1, 3)
    assert (east.crash_count, east.killed, east.injured) == (1, 3, 0)


def test_splits_by_year():
    crashes = _crashes([
        (0.5, 0.5, 2022, 0, 1),
        (0.5, 0.5, 2023, 1, 0),
    ])
    out = aggregate_crashes_to_tracts(crashes, _tracts())

    assert len(out) == 2
    assert set(out.year) == {2022, 2023}
    assert out.crash_count.tolist() == [1, 1]


def test_drops_crashes_outside_every_tract():
    """Bad or out-of-state coordinates fall out of the join, not into a tract."""
    crashes = _crashes([
        (0.5, 0.5, 2023, 0, 0),      # inside WEST
        (50.0, -120.0, 2023, 9, 9),  # nowhere near either square
        (0.5, 7.0, 2023, 9, 9),      # east of both
    ])
    out = aggregate_crashes_to_tracts(crashes, _tracts())

    assert len(out) == 1
    assert out.iloc[0].geoid == "06001000001"
    assert out.iloc[0].crash_count == 1
    # The dropped rows carried 18 deaths; none of them may leak into a tract.
    assert out.killed.sum() == 0


def test_empty_input_returns_empty_frame_with_the_right_columns():
    out = aggregate_crashes_to_tracts(_crashes([]), _tracts())
    assert out.empty
    assert list(out.columns) == ["geoid", "year", "crash_count", "killed", "injured"]


def test_counts_are_ints_not_floats():
    """The DB columns are INTEGER; a float sum would round-trip badly."""
    out = aggregate_crashes_to_tracts(
        _crashes([(0.5, 0.5, 2023, 1, 2)]), _tracts()
    )
    row = out.iloc[0]
    assert isinstance(row.crash_count, int) or row.crash_count.dtype.kind == "i"
    assert int(row.killed) == 1 and int(row.injured) == 2

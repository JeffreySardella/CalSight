"""Tests for coordinate-vs-county-boundary validation.

`validate_batch` and `load_county_polygons` are pure geometry logic and are
tested directly. `run()` drives a real Postgres session end-to-end in
production, so here it's exercised with `SessionLocal` and the GeoJSON path
both patched — same "mock the DB, keep the branching logic honest" pattern
as sibling ETL tests (test_backfill_derived.py, test_backfill_conditions.py).
"""

import json
from unittest.mock import MagicMock

import pytest

import etl.validate_coords as vc
from etl.validate_coords import load_county_polygons, validate_batch

# A 1-degree square "county 1" and a disjoint square "county 2", far enough
# apart that a point can unambiguously be inside one, the other, or neither.
_GEOJSON = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"county_code": 1},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
            },
        },
        {
            "type": "Feature",
            "properties": {"county_code": 2},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[10, 10], [10, 11], [11, 11], [11, 10], [10, 10]]],
            },
        },
    ],
}


@pytest.fixture()
def geojson_path(tmp_path):
    path = tmp_path / "counties.geojson"
    path.write_text(json.dumps(_GEOJSON))
    return str(path)


class TestLoadCountyPolygons:
    def test_loads_one_polygon_per_feature(self, geojson_path):
        polygons = load_county_polygons(geojson_path)
        assert set(polygons.keys()) == {1, 2}

    def test_no_buffer_by_default(self, geojson_path):
        polygons = load_county_polygons(geojson_path)
        # A point just outside the unbuffered square is a mismatch.
        assert polygons[1].contains(__import__("shapely.geometry", fromlist=["Point"]).Point(1.001, 0.5)) is False

    def test_buffer_grows_the_polygon(self, geojson_path):
        from shapely.geometry import Point
        # ~1100m buffer (~0.01 degrees) should swallow a point just outside
        # the strict boundary that the unbuffered polygon rejects.
        buffered = load_county_polygons(geojson_path, buffer_m=1100)
        assert buffered[1].contains(Point(1.005, 0.5)) is True


class TestValidateBatch:
    def test_point_inside_its_assigned_county_is_valid(self, geojson_path):
        polygons = load_county_polygons(geojson_path)
        mismatches, valid = validate_batch([(1, 0.5, 0.5, 1)], polygons)
        assert mismatches == []
        assert valid == [1]

    def test_point_outside_its_assigned_county_is_mismatch(self, geojson_path):
        polygons = load_county_polygons(geojson_path)
        # Crash id 2 claims county 1 but its coordinates sit in county 2's box.
        mismatches, valid = validate_batch([(2, 10.5, 10.5, 1)], polygons)
        assert mismatches == [2]
        assert valid == []

    def test_unknown_county_code_is_a_mismatch(self, geojson_path):
        polygons = load_county_polygons(geojson_path)
        mismatches, valid = validate_batch([(3, 0.5, 0.5, 99)], polygons)
        assert mismatches == [3]
        assert valid == []

    def test_batch_mixes_valid_and_mismatched(self, geojson_path):
        polygons = load_county_polygons(geojson_path)
        rows = [
            (1, 0.5, 0.5, 1),      # valid
            (2, 10.5, 10.5, 2),    # valid
            (3, 5.0, 5.0, 1),      # mismatch: not in county 1's box
        ]
        mismatches, valid = validate_batch(rows, polygons)
        assert sorted(mismatches) == [3]
        assert sorted(valid) == [1, 2]


class TestRun:
    def _patch_session(self, monkeypatch, geojson_path, *, total, batches):
        """total: scalar for the COUNT(*) query.
        batches: list of fetchall() results, one per polygon-scan loop
        iteration; the loop stops at the first empty list.
        """
        db = MagicMock()
        db.execute.return_value.scalar.return_value = total
        db.execute.return_value.fetchall.side_effect = batches

        monkeypatch.setattr(vc, "GEOJSON_PATH", geojson_path)
        monkeypatch.setattr(vc, "SessionLocal", lambda: db)
        return db

    def test_no_coordinate_rows_returns_zero_mismatches(self, monkeypatch, geojson_path):
        self._patch_session(monkeypatch, geojson_path, total=0, batches=[[]])
        assert vc.run() == 0

    def test_audit_only_does_not_call_update(self, monkeypatch, geojson_path):
        # county 1 point that's actually a mismatch (sits in county 2's box).
        rows = [(1, 10.5, 10.5, 1)]
        db = self._patch_session(monkeypatch, geojson_path, total=1, batches=[rows, []])

        total_mismatches = vc.run(audit_only=True)

        assert total_mismatches == 1
        # No UPDATE should have been issued in audit-only mode.
        update_calls = [c for c in db.execute.call_args_list if "UPDATE" in str(c)]
        assert update_calls == []

    def test_updates_mismatches_and_valid_rows_when_not_audit_only(self, monkeypatch, geojson_path):
        rows = [(1, 0.5, 0.5, 1), (2, 10.5, 10.5, 1)]  # one valid, one mismatch
        db = self._patch_session(monkeypatch, geojson_path, total=2, batches=[rows, []])

        total_mismatches = vc.run(audit_only=False)

        assert total_mismatches == 1
        db.commit.assert_called()

    def test_county_code_filter_is_passed_through(self, monkeypatch, geojson_path):
        db = self._patch_session(monkeypatch, geojson_path, total=0, batches=[[]])
        vc.run(county_code=19)
        # The COUNT(*) query must have been parameterized with county_code=19.
        first_call = db.execute.call_args_list[0]
        assert first_call.args[1] == {"county_code": 19}

    def test_missing_geojson_exits(self, monkeypatch, tmp_path):
        monkeypatch.setattr(vc, "GEOJSON_PATH", str(tmp_path / "nope.geojson"))
        monkeypatch.setattr(vc, "GEOJSON_FALLBACK", str(tmp_path / "also-nope.geojson"))
        with pytest.raises(SystemExit):
            vc.run()

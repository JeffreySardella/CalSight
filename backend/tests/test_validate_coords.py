"""Tests for coordinate validation logic.

Tests the point-in-polygon checking without needing a database — exercises
validate_batch() with synthetic data and verifies polygon loading.
"""

import os

from etl.validate_coords import load_county_polygons, validate_batch

GEOJSON_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "frontend", "public", "ca-counties.geojson"
)


class TestLoadCountyPolygons:
    def test_loads_all_58_counties(self):
        polygons = load_county_polygons(GEOJSON_PATH, buffer_m=0)
        assert len(polygons) == 58

    def test_keys_are_county_codes(self):
        polygons = load_county_polygons(GEOJSON_PATH, buffer_m=0)
        for code in polygons:
            assert isinstance(code, int)
            assert 1 <= code <= 58

    def test_buffer_expands_polygon(self):
        strict = load_county_polygons(GEOJSON_PATH, buffer_m=0)
        buffered = load_county_polygons(GEOJSON_PATH, buffer_m=1000)
        # A point just outside strict should be inside buffered
        from shapely.geometry import Point
        # Point slightly outside Alameda county (code 1) border
        p = Point(-122.033, 37.463)
        assert not strict[1].contains(p)
        assert buffered[1].contains(p)


class TestValidateBatch:
    def setup_method(self):
        self.polygons = load_county_polygons(GEOJSON_PATH, buffer_m=0)

    def test_point_inside_la_county(self):
        # Downtown LA: ~34.05, -118.25 — county_code 19
        rows = [(1, 34.05, -118.25, 19)]
        mismatches, valid = validate_batch(rows, self.polygons)
        assert valid == [1]
        assert mismatches == []

    def test_point_outside_assigned_county(self):
        # Downtown LA coords but assigned to San Francisco (county 38)
        rows = [(2, 34.05, -118.25, 38)]
        mismatches, valid = validate_batch(rows, self.polygons)
        assert mismatches == [2]
        assert valid == []

    def test_point_in_sf(self):
        # Golden Gate Park area: ~37.77, -122.45 — county_code 38
        rows = [(3, 37.77, -122.45, 38)]
        mismatches, valid = validate_batch(rows, self.polygons)
        assert valid == [3]
        assert mismatches == []

    def test_unknown_county_code_is_mismatch(self):
        rows = [(4, 34.05, -118.25, 99)]
        mismatches, valid = validate_batch(rows, self.polygons)
        assert mismatches == [4]
        assert valid == []

    def test_batch_with_mixed_results(self):
        rows = [
            (10, 34.05, -118.25, 19),   # valid (LA in LA)
            (11, 34.05, -118.25, 38),   # mismatch (LA coords in SF)
            (12, 37.77, -122.45, 38),   # valid (SF in SF)
            (13, 36.75, -119.77, 10),   # valid (Fresno in Fresno)
        ]
        mismatches, valid = validate_batch(rows, self.polygons)
        assert set(valid) == {10, 12, 13}
        assert set(mismatches) == {11}

    def test_point_near_county_border(self):
        # Point right on the border of Alameda/Contra Costa — test it doesn't crash
        rows = [(5, 37.82, -122.05, 1)]
        mismatches, valid = validate_batch(rows, self.polygons)
        assert len(mismatches) + len(valid) == 1

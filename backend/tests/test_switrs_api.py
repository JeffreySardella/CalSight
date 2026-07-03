"""Tests for the SWITRS SQLite archive client.

These test the transform_switrs() function in isolation — no file I/O,
no network calls, no SQLite required. We pass raw dicts that mirror what
sqlite3.Row would look like after dict() conversion.

All tests live in TestTransformSwitrs.
"""

import pytest
from datetime import datetime

from etl.switrs_api import transform_switrs


# ---------------------------------------------------------------------------
# Sample data
# ---------------------------------------------------------------------------

# A complete, realistic SWITRS collision row.
# Field names match the SWITRS SQLite `collisions` table columns (lowercase).
SAMPLE_SWITRS_ROW = {
    "case_id": 5432100,
    "collision_date": "2012-07-15",
    "collision_time": "14:30:00",
    "county_city_location": "0100",
    "primary_road": "MAIN ST",
    "secondary_road": "OAK AVE",
    "latitude": 37.8044,
    "longitude": -122.2712,
    "type_of_collision": "A",
    "pcf_violation_category": "01",
    "motor_vehicle_involved_with": "A",
    "killed_victims": 0,
    "injured_victims": 1,
    "weather_1": "A",
    "road_surface": "A",
    "lighting": "A",
    "state_highway_indicator": 1,
    "hit_and_run": "M",
    "pedestrian_action": "B",
}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestTransformSwitrs:
    def test_transforms_basic_record(self):
        """All fields from a complete record should map to correct column names."""
        result = transform_switrs(SAMPLE_SWITRS_ROW)

        assert result["collision_id"] == 5432100
        assert result["county_code"] == 1
        assert result["latitude"] == pytest.approx(37.8044)
        assert result["longitude"] == pytest.approx(-122.2712)
        assert result["primary_road"] == "MAIN ST"
        assert result["secondary_road"] == "OAK AVE"
        assert result["number_killed"] == 0
        assert result["number_injured"] == 1
        assert result["data_source"] == "switrs"

    def test_combines_date_and_time(self):
        """collision_date and collision_time should be merged into one datetime."""
        result = transform_switrs(SAMPLE_SWITRS_ROW)

        dt = result["crash_datetime"]
        assert isinstance(dt, datetime)
        assert dt.year == 2012
        assert dt.month == 7
        assert dt.day == 15
        assert dt.hour == 14
        assert dt.minute == 30

    def test_parses_county_code_from_county_city_location(self):
        """county_city_location '0100' should yield county_code 1 (first 2 digits)."""
        result = transform_switrs({**SAMPLE_SWITRS_ROW, "county_city_location": "0100"})

        assert result["county_code"] == 1

    def test_maps_highway_indicator(self):
        """state_highway_indicator 1 should map to is_highway=True."""
        result = transform_switrs({**SAMPLE_SWITRS_ROW, "state_highway_indicator": 1})

        assert result["is_highway"] is True

    def test_highway_indicator_no(self):
        """state_highway_indicator 0 should map to is_highway=False."""
        result = transform_switrs({**SAMPLE_SWITRS_ROW, "state_highway_indicator": 0})

        assert result["is_highway"] is False

    def test_hit_run_misdemeanor(self):
        """hit_and_run 'M' should pass through as 'M'."""
        result = transform_switrs({**SAMPLE_SWITRS_ROW, "hit_and_run": "M"})

        assert result["hit_run"] == "M"

    def test_hit_run_felony(self):
        """hit_and_run 'F' should pass through as 'F'."""
        result = transform_switrs({**SAMPLE_SWITRS_ROW, "hit_and_run": "F"})

        assert result["hit_run"] == "F"

    def test_hit_run_not_hit_run(self):
        """hit_and_run '-' should become None (not a hit-and-run crash)."""
        result = transform_switrs({**SAMPLE_SWITRS_ROW, "hit_and_run": "-"})

        assert result["hit_run"] is None

    def test_pedestrian_involved(self):
        """A non-empty, non-dash pedestrian_action means a pedestrian was involved."""
        result = transform_switrs({**SAMPLE_SWITRS_ROW, "pedestrian_action": "B"})

        assert result["pedestrian_involved"] is True

    def test_pedestrian_not_involved(self):
        """A null pedestrian_action means no pedestrian was involved."""
        result = transform_switrs({**SAMPLE_SWITRS_ROW, "pedestrian_action": None})

        assert result["pedestrian_involved"] is False

    def test_handles_null_lat_lon(self):
        """Missing coordinates should become None, not raise an error."""
        result = transform_switrs(
            {**SAMPLE_SWITRS_ROW, "latitude": None, "longitude": None}
        )

        assert result["latitude"] is None
        assert result["longitude"] is None

    def test_handles_null_time(self):
        """A null collision_time should default to midnight (hour=0, minute=0)."""
        result = transform_switrs({**SAMPLE_SWITRS_ROW, "collision_time": None})

        dt = result["crash_datetime"]
        assert isinstance(dt, datetime)
        assert dt.hour == 0
        assert dt.minute == 0

    def test_malformed_time_falls_back_to_midnight(self):
        """Non-numeric time values ('UNK:00') appear in the archive; one bad
        row must not abort the multi-hour load — fall back to midnight."""
        for bad in ("UNK:00", "abc", "25:99:00", "-1:30"):
            result = transform_switrs({**SAMPLE_SWITRS_ROW, "collision_time": bad})
            dt = result["crash_datetime"]
            assert isinstance(dt, datetime), f"Failed for {bad!r}"
            assert (dt.hour, dt.minute) == (0, 0), f"Failed for {bad!r}"

    def test_handles_two_digit_county(self):
        """county_city_location '1900' should yield county_code 19."""
        result = transform_switrs({**SAMPLE_SWITRS_ROW, "county_city_location": "1900"})

        assert result["county_code"] == 19


class TestIterCrashesFromSqlite:
    """The streaming reader must yield bounded batches — materializing the
    full 15-year archive (~6-7M dicts) has OOM-killed the ETL VM before."""

    def _make_db(self, tmp_path, rows):
        import sqlite3

        path = tmp_path / "switrs.sqlite"
        conn = sqlite3.connect(path)
        cols = ", ".join(SAMPLE_SWITRS_ROW.keys())
        placeholders = ", ".join("?" for _ in SAMPLE_SWITRS_ROW)
        conn.execute(f"CREATE TABLE collisions ({cols})")
        conn.executemany(
            f"INSERT INTO collisions ({cols}) VALUES ({placeholders})",
            [tuple(r[k] for k in SAMPLE_SWITRS_ROW) for r in rows],
        )
        conn.commit()
        conn.close()
        return str(path)

    def test_yields_batches_of_at_most_batch_size(self, tmp_path):
        from etl.switrs_api import iter_crashes_from_sqlite

        rows = [
            {**SAMPLE_SWITRS_ROW, "case_id": 1000 + i, "collision_date": "2012-07-15"}
            for i in range(5)
        ]
        path = self._make_db(tmp_path, rows)

        batches = list(iter_crashes_from_sqlite(path, 2012, 2012, batch_size=2))
        assert [len(b) for b in batches] == [2, 2, 1]
        assert {r["collision_id"] for b in batches for r in b} == {1000, 1001, 1002, 1003, 1004}

    def test_skips_rows_without_id_or_date(self, tmp_path):
        from etl.switrs_api import iter_crashes_from_sqlite

        rows = [
            {**SAMPLE_SWITRS_ROW, "case_id": 1},
            {**SAMPLE_SWITRS_ROW, "case_id": None},
            {**SAMPLE_SWITRS_ROW, "case_id": 3, "collision_date": None},
        ]
        path = self._make_db(tmp_path, rows)

        batches = list(iter_crashes_from_sqlite(path, 2012, 2012, batch_size=10))
        all_rows = [r for b in batches for r in b]
        assert [r["collision_id"] for r in all_rows] == [1]

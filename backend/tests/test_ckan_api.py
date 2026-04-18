"""Tests for the CCRS CKAN API client.

These use mocking — we fake the HTTP responses so tests don't hit
the real CKAN API. This makes tests fast, reliable, and free.

Two test classes:
- TestTransformCcrs  — unit tests for the transform_ccrs() function
- TestFetchCrashesForYear — integration tests for the fetch function (mocked HTTP)
"""

import httpx
import pytest
from datetime import datetime
from unittest.mock import patch, MagicMock

from etl.ckan_api import (
    transform_ccrs,
    fetch_crashes_for_year,
    PAGE_SIZE,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_ckan_response(records: list[dict], total: int) -> MagicMock:
    """Return a MagicMock that mimics a CKAN DataStore Search HTTP response.

    CKAN returns:
        {"result": {"total": <int>, "records": [...]}}
    """
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {
        "result": {
            "total": total,
            "records": records,
        }
    }
    return mock_resp


# A minimal but complete raw CCRS record (all field names as they appear in the API).
_BASE_RAW_RECORD = {
    "Collision Id": "123456",
    "Crash Date Time": "2022-06-15T14:30:00",
    "DayofWeek": "Wednesday",
    "County Code": "19",
    "City Name": "Los Angeles",
    "Latitude": "34.052235",
    "Longitude": "-118.243683",
    "Collision Type Description": "Rear End",
    "Primary Collision Factor Violation": "Unsafe Speed",
    "MotorVehicleInvolvedWithDesc": "Pedestrian",
    "NumberKilled": "0",
    "NumberInjured": "2",
    "Weather 1": "Clear",
    "Road Condition 1": "Dry",
    "LightingDescription": "Daylight",
    "IsHighwayRelated": "False",
    "IsFreeway": "False",
    "PrimaryRoad": "Main St",
    "SecondaryRoad": "1st Ave",
    "HitRun": None,
    "PedestrianActionCode": None,
}


# ---------------------------------------------------------------------------
# Transform tests
# ---------------------------------------------------------------------------

class TestTransformCcrs:
    def test_transforms_basic_record(self):
        """All fields from a complete record should map to correct column names."""
        result = transform_ccrs(_BASE_RAW_RECORD)

        assert result["collision_id"] == 123456
        assert result["day_of_week"] == "Wednesday"
        assert result["county_code"] == 19
        assert result["city_name"] == "Los Angeles"
        assert result["latitude"] == pytest.approx(34.052235)
        assert result["longitude"] == pytest.approx(-118.243683)
        assert result["collision_type"] == "Rear End"
        assert result["primary_factor"] == "Unsafe Speed"
        assert result["motor_vehicle_involved_with"] == "Pedestrian"
        assert result["number_injured"] == 2
        assert result["weather"] == "Clear"
        assert result["road_condition"] == "Dry"
        assert result["lighting"] == "Daylight"
        assert result["is_highway"] is False
        assert result["is_freeway"] is False
        assert result["primary_road"] == "Main St"
        assert result["secondary_road"] == "1st Ave"
        assert result["data_source"] == "ccrs"

    def test_parses_crash_datetime(self):
        """ISO 8601 string should be parsed into a Python datetime object."""
        result = transform_ccrs(_BASE_RAW_RECORD)

        assert isinstance(result["crash_datetime"], datetime)
        assert result["crash_datetime"] == datetime(2022, 6, 15, 14, 30, 0)

    def test_casts_number_killed_from_text(self):
        """NumberKilled is stored as TEXT in CCRS — must be cast to int."""
        record = {**_BASE_RAW_RECORD, "NumberKilled": "3"}
        result = transform_ccrs(record)

        assert result["number_killed"] == 3
        assert isinstance(result["number_killed"], int)

    def test_maps_string_booleans(self):
        """'True'/'False' strings should be converted to Python booleans."""
        record = {**_BASE_RAW_RECORD, "IsHighwayRelated": "True", "IsFreeway": "False"}
        result = transform_ccrs(record)

        assert result["is_highway"] is True
        assert result["is_freeway"] is False

    def test_hit_run_null_stays_none(self):
        """A null HitRun field should remain None (not hit-and-run crash)."""
        record = {**_BASE_RAW_RECORD, "HitRun": None}
        result = transform_ccrs(record)

        assert result["hit_run"] is None

    def test_hit_run_maps_to_single_char(self):
        """Full words like 'MISDEMEANOR' and 'FELONY' should map to 'M' and 'F'."""
        misdemeanor_record = {**_BASE_RAW_RECORD, "HitRun": "MISDEMEANOR"}
        felony_record = {**_BASE_RAW_RECORD, "HitRun": "FELONY"}

        assert transform_ccrs(misdemeanor_record)["hit_run"] == "M"
        assert transform_ccrs(felony_record)["hit_run"] == "F"

    def test_pedestrian_not_involved(self):
        """A null PedestrianActionCode means no pedestrian was involved."""
        record = {**_BASE_RAW_RECORD, "PedestrianActionCode": None}
        result = transform_ccrs(record)

        assert result["pedestrian_involved"] is False

    def test_pedestrian_involved(self):
        """A non-empty, non-zero PedestrianActionCode means a pedestrian was involved."""
        record = {**_BASE_RAW_RECORD, "PedestrianActionCode": "A"}
        result = transform_ccrs(record)

        assert result["pedestrian_involved"] is True

    def test_handles_null_lat_lon(self):
        """Missing coordinates should become None, not raise an error."""
        record = {**_BASE_RAW_RECORD, "Latitude": None, "Longitude": None}
        result = transform_ccrs(record)

        assert result["latitude"] is None
        assert result["longitude"] is None

    def test_handles_null_number_killed(self):
        """A null NumberKilled value should produce None (not 0 or an error)."""
        record = {**_BASE_RAW_RECORD, "NumberKilled": None}
        result = transform_ccrs(record)

        assert result["number_killed"] is None


# ---------------------------------------------------------------------------
# Fetch tests
# ---------------------------------------------------------------------------

def _collect_all_batches(year: int) -> list[dict]:
    """Helper: consume the generator and flatten all batches into a single list."""
    all_rows = []
    for batch, offset, total in fetch_crashes_for_year(year):
        all_rows.extend(batch)
    return all_rows


class TestFetchCrashesForYear:
    @patch("etl.ckan_api.httpx.get")
    def test_fetches_single_page(self, mock_get):
        """When total <= PAGE_SIZE, exactly one HTTP request should be made."""
        records = [
            {**_BASE_RAW_RECORD, "Collision Id": str(i)}
            for i in range(1, 6)  # 5 records
        ]
        mock_get.return_value = _mock_ckan_response(records, total=5)

        results = _collect_all_batches(2022)

        assert mock_get.call_count == 1
        assert len(results) == 5

    @patch("etl.ckan_api.httpx.get")
    def test_paginates_multiple_pages(self, mock_get):
        """When total > PAGE_SIZE, the fetcher should request additional pages."""
        # Simulate 3 pages: two full pages + one partial page
        total = PAGE_SIZE * 2 + 10

        # Page 1: full page
        page1_records = [
            {**_BASE_RAW_RECORD, "Collision Id": str(i)}
            for i in range(1, PAGE_SIZE + 1)
        ]
        # Page 2: full page
        page2_records = [
            {**_BASE_RAW_RECORD, "Collision Id": str(i)}
            for i in range(PAGE_SIZE + 1, PAGE_SIZE * 2 + 1)
        ]
        # Page 3: 10 remaining records
        page3_records = [
            {**_BASE_RAW_RECORD, "Collision Id": str(i)}
            for i in range(PAGE_SIZE * 2 + 1, PAGE_SIZE * 2 + 11)
        ]

        mock_get.side_effect = [
            _mock_ckan_response(page1_records, total=total),
            _mock_ckan_response(page2_records, total=total),
            _mock_ckan_response(page3_records, total=total),
        ]

        results = _collect_all_batches(2022)

        assert mock_get.call_count == 3
        assert len(results) == total

    @patch("etl.ckan_api.httpx.get")
    def test_yields_batches_with_progress(self, mock_get):
        """Each yielded tuple should include (batch, offset, total) for progress tracking."""
        records = [
            {**_BASE_RAW_RECORD, "Collision Id": str(i)}
            for i in range(1, 6)
        ]
        mock_get.return_value = _mock_ckan_response(records, total=5)

        batches = list(fetch_crashes_for_year(2022))

        assert len(batches) == 1
        batch, offset, total = batches[0]
        assert len(batch) == 5
        assert offset == 5
        assert total == 5

    @patch("etl.ckan_api.httpx.get")
    def test_retries_on_failure(self, mock_get):
        """Should retry up to MAX_RETRIES times on HTTP errors, then raise."""
        mock_get.side_effect = httpx.HTTPStatusError(
            "500 Server Error",
            request=MagicMock(),
            response=MagicMock(status_code=500),
        )

        with pytest.raises(httpx.HTTPStatusError):
            _collect_all_batches(2022)

        assert mock_get.call_count == 3

    def test_raises_for_unknown_year(self):
        """Requesting a year not in RESOURCE_IDS should raise KeyError immediately."""
        with pytest.raises(KeyError):
            _collect_all_batches(2000)

    @patch("etl.ckan_api.httpx.get")
    def test_skips_records_with_null_collision_id(self, mock_get):
        """Records where Collision Id is null/empty after transform should be dropped."""
        records = [
            {**_BASE_RAW_RECORD, "Collision Id": "111"},   # valid
            {**_BASE_RAW_RECORD, "Collision Id": None},     # null — skip
            {**_BASE_RAW_RECORD, "Collision Id": ""},       # empty string — skip
            {**_BASE_RAW_RECORD, "Collision Id": "222"},    # valid
        ]
        mock_get.return_value = _mock_ckan_response(records, total=4)

        results = _collect_all_batches(2022)

        # Only the two records with valid Collision Ids should be returned
        assert len(results) == 2
        collision_ids = {r["collision_id"] for r in results}
        assert collision_ids == {111, 222}

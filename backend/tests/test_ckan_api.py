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

    def test_pedestrian_not_involved_null(self):
        """A null PedestrianActionCode means no pedestrian was involved."""
        record = {**_BASE_RAW_RECORD, "PedestrianActionCode": None}
        assert transform_ccrs(record)["pedestrian_involved"] is False

    def test_pedestrian_not_involved_code_a(self):
        """Code 'A' = No Pedestrian Involved."""
        record = {**_BASE_RAW_RECORD, "PedestrianActionCode": "A"}
        assert transform_ccrs(record)["pedestrian_involved"] is False

    def test_pedestrian_involved_code_b(self):
        """Code 'B' = Crossing in crosswalk at intersection."""
        record = {**_BASE_RAW_RECORD, "PedestrianActionCode": "B"}
        assert transform_ccrs(record)["pedestrian_involved"] is True

    def test_pedestrian_involved_code_d(self):
        """Code 'D' = In road (including shoulder)."""
        record = {**_BASE_RAW_RECORD, "PedestrianActionCode": "D"}
        assert transform_ccrs(record)["pedestrian_involved"] is True

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


# ---------------------------------------------------------------------------
# Resource discovery (Jan-2027 regression: hardcoded RESOURCE_IDS meant a new
# calendar year's resource was never picked up until a manual code change,
# while freshness kept reporting green against the pinned prior-year resource)
# ---------------------------------------------------------------------------

def _mock_package_show(resources: list[dict]) -> MagicMock:
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {"result": {"resources": resources}}
    return mock_resp


_PACKAGE_RESOURCES = [
    {"name": "Raw Data Template", "id": "template-id", "datastore_active": False},
    {"name": "Crashes_2026", "id": "crashes-2026-id", "datastore_active": True},
    {"name": "Crashes_2027", "id": "crashes-2027-id", "datastore_active": True},
    {"name": "Parties_2026", "id": "parties-2026-id", "datastore_active": True},
    {"name": "InjuredWitnessPassengers_2026", "id": "victims-2026-id", "datastore_active": True},
    # A resource CKAN knows about but whose datastore isn't loaded yet must
    # not be offered for loading — datastore_search would 404 on it.
    {"name": "Crashes_2028", "id": "crashes-2028-id", "datastore_active": False},
]


@pytest.fixture(autouse=True)
def _clear_discovery_cache():
    from etl import ckan_api
    getattr(ckan_api, "_DISCOVERY_CACHE", {}).clear()
    yield
    getattr(ckan_api, "_DISCOVERY_CACHE", {}).clear()


class TestDiscoverResourceIds:
    @patch("etl.ckan_api.httpx.get")
    def test_finds_years_matching_prefix(self, mock_get):
        from etl.ckan_api import discover_resource_ids
        mock_get.return_value = _mock_package_show(_PACKAGE_RESOURCES)

        found = discover_resource_ids("Crashes")

        assert found == {2026: "crashes-2026-id", 2027: "crashes-2027-id"}

    @patch("etl.ckan_api.httpx.get")
    def test_parties_prefix_does_not_match_crashes(self, mock_get):
        from etl.ckan_api import discover_resource_ids
        mock_get.return_value = _mock_package_show(_PACKAGE_RESOURCES)

        assert discover_resource_ids("Parties") == {2026: "parties-2026-id"}

    @patch("etl.ckan_api.httpx.get")
    def test_network_failure_returns_empty(self, mock_get):
        from etl.ckan_api import discover_resource_ids
        mock_get.side_effect = httpx.ConnectError("boom")

        assert discover_resource_ids("Crashes") == {}

    @patch("etl.ckan_api.httpx.get")
    def test_result_is_cached_per_process(self, mock_get):
        from etl.ckan_api import discover_resource_ids
        mock_get.return_value = _mock_package_show(_PACKAGE_RESOURCES)

        discover_resource_ids("Crashes")
        discover_resource_ids("Crashes")

        assert mock_get.call_count == 1

    @patch("etl.ckan_api.httpx.get")
    def test_failure_is_not_cached(self, mock_get):
        from etl.ckan_api import discover_resource_ids
        mock_get.side_effect = [
            httpx.ConnectError("boom"),
            _mock_package_show(_PACKAGE_RESOURCES),
        ]

        assert discover_resource_ids("Crashes") == {}
        assert discover_resource_ids("Crashes") == {2026: "crashes-2026-id", 2027: "crashes-2027-id"}


class TestDiscoveryCacheTtl:
    """M7: the discovery cache lives inside the weeks-old scheduler process.

    Without a TTL, the freshness probe kept seeing January's package listing
    until a container restart, so a newly published Crashes_<year> resource
    was invisible to the daily pipeline (data arrived at weekly-force-run
    cadence at best). Entries must expire, but slowly enough that a single
    pipeline run still sees a stable view of the package.
    """

    def _freeze_clock(self, monkeypatch, start=1_000_000.0):
        from etl import ckan_api
        clock = {"now": start}
        monkeypatch.setattr(ckan_api.time, "monotonic", lambda: clock["now"])
        return clock

    @patch("etl.ckan_api.httpx.get")
    def test_within_ttl_serves_cached_result(self, mock_get, monkeypatch):
        from etl import ckan_api
        clock = self._freeze_clock(monkeypatch)
        mock_get.return_value = _mock_package_show(_PACKAGE_RESOURCES)

        first = ckan_api.discover_resource_ids("Crashes")
        clock["now"] += ckan_api._DISCOVERY_TTL_SECONDS - 1
        second = ckan_api.discover_resource_ids("Crashes")

        assert mock_get.call_count == 1
        assert second == first

    @patch("etl.ckan_api.httpx.get")
    def test_expired_entry_refetches_and_sees_new_year(self, mock_get, monkeypatch):
        from etl import ckan_api
        clock = self._freeze_clock(monkeypatch)
        newly_published = _PACKAGE_RESOURCES + [
            {"name": "Crashes_2029", "id": "crashes-2029-id", "datastore_active": True},
        ]
        mock_get.side_effect = [
            _mock_package_show(_PACKAGE_RESOURCES),
            _mock_package_show(newly_published),
        ]

        first = ckan_api.discover_resource_ids("Crashes")
        assert 2029 not in first

        clock["now"] += ckan_api._DISCOVERY_TTL_SECONDS + 1
        second = ckan_api.discover_resource_ids("Crashes")

        assert mock_get.call_count == 2
        assert second[2029] == "crashes-2029-id"

    def test_ttl_sits_between_run_duration_and_daily_cadence(self):
        """The TTL must exceed the longest single pipeline run (parties has a
        6h job timeout) so resources never appear mid-run, and stay under the
        24h daily cadence so the next daily run always re-lists the package."""
        from etl import ckan_api
        assert ckan_api._DISCOVERY_TTL_SECONDS >= 6 * 60 * 60
        assert ckan_api._DISCOVERY_TTL_SECONDS < 24 * 60 * 60


class TestMergedResourceIds:
    @patch("etl.ckan_api.httpx.get")
    def test_discovered_year_extends_static_map(self, mock_get):
        from etl.ckan_api import merged_resource_ids
        mock_get.return_value = _mock_package_show(_PACKAGE_RESOURCES)
        static = {2025: "static-2025", 2026: "static-2026"}

        merged = merged_resource_ids("Crashes", static)

        assert merged[2027] == "crashes-2027-id"  # new year discovered
        assert merged[2025] == "static-2025"      # static entries preserved
        assert merged[2026] == "crashes-2026-id"  # discovery is fresher, wins

    @patch("etl.ckan_api.httpx.get")
    def test_discovery_failure_degrades_to_static(self, mock_get):
        from etl.ckan_api import merged_resource_ids
        mock_get.side_effect = httpx.ConnectError("boom")
        static = {2025: "static-2025", 2026: "static-2026"}

        assert merged_resource_ids("Crashes", static) == static

"""Tests for the Census API client.

These use mocking — we fake the HTTP responses so tests don't hit
the real Census API. This makes tests fast, reliable, and free.

The client now makes 2 requests per year:
  1. Profile request (race, poverty, education, housing, language, commute)
  2. Age distribution request (B01001 sex-by-age cells)
"""

import httpx
import pytest
from unittest.mock import patch, MagicMock

from etl.census_api import (
    fetch_county_demographics,
    PROFILE_VARIABLES,
    AGE_VARIABLES,
    EDUCATION_VARIABLES,
    _pct,
    _sum_cells,
)


# ── Mock data for Request 1: profile ──────────────────────────────────

MOCK_PROFILE_HEADER = list(PROFILE_VARIABLES.keys()) + ["state", "county"]

MOCK_PROFILE_ROW = [
    "1000000",  # B01003_001E population
    "35.2",     # B01002_001E median_age
    "65000",    # B19013_001E median_income
    "800000",   # B08006_001E commute_total
    "500000",   # B08006_003E drive alone
    "80000",    # B08006_004E carpool
    "50000",    # B08006_008E transit
    "30000",    # B08006_005E walk
    "10000",    # B08006_014E bike
    "70000",    # B08006_017E wfh
    "1000000",  # B03002_001E race_total
    "400000",   # B03002_003E white
    "60000",    # B03002_004E black
    "150000",   # B03002_006E asian
    "350000",   # B03002_012E hispanic
    "900000",   # B17001_001E poverty_total
    "108000",   # B17001_002E poverty_below (12%)
    "400000",   # B08201_001E vehicle_total
    "28000",    # B08201_002E vehicle_none (7%)
    "380000",   # B25003_001E housing_total
    "209000",   # B25003_002E housing_owner (55%)
    "900000",   # B16001_001E lang_total
    "540000",   # B16001_002E english_only (60%)
    "270000",   # B16001_003E spanish (30%)
    "06",       # state
    "001",      # county (Alameda)
]

MOCK_PROFILE_JSON = [MOCK_PROFILE_HEADER, MOCK_PROFILE_ROW]


# ── Mock data for Request 2: age distribution ─────────────────────────

MOCK_AGE_HEADER = AGE_VARIABLES + ["state", "county"]

def _build_age_row():
    """Build a mock age row with known values for bracket computation.

    Total population: 1,000,000
    Under 18: 220,000 (22%)
    18-24: 100,000 (10%)
    25-44: 280,000 (28%)
    45-64: 260,000 (26%)
    65+: 140,000 (14%)
    """
    row = {}
    row["B01001_001E"] = "1000000"

    # Male under 18: cells 003-006 = 30k each = 120k
    for i in [3, 4, 5, 6]:
        row[f"B01001_{i:03d}E"] = "30000"
    # Female under 18: cells 027-030 = 25k each = 100k
    for i in [27, 28, 29, 30]:
        row[f"B01001_{i:03d}E"] = "25000"
    # Total under 18: 120k + 100k = 220k (22%)

    # Male 18-24: cells 007-010 = 12.5k each = 50k
    for i in [7, 8, 9, 10]:
        row[f"B01001_{i:03d}E"] = "12500"
    # Female 18-24: cells 031-034 = 12.5k each = 50k
    for i in [31, 32, 33, 34]:
        row[f"B01001_{i:03d}E"] = "12500"
    # Total 18-24: 50k + 50k = 100k (10%)

    # Male 25-44: cells 011-014 = 35k each = 140k
    for i in [11, 12, 13, 14]:
        row[f"B01001_{i:03d}E"] = "35000"
    # Female 25-44: cells 035-038 = 35k each = 140k
    for i in [35, 36, 37, 38]:
        row[f"B01001_{i:03d}E"] = "35000"
    # Total 25-44: 140k + 140k = 280k (28%)

    # Male 45-64: cells 015-019 = 26k each = 130k
    for i in [15, 16, 17, 18, 19]:
        row[f"B01001_{i:03d}E"] = "26000"
    # Female 45-64: cells 039-043 = 26k each = 130k
    for i in [39, 40, 41, 42, 43]:
        row[f"B01001_{i:03d}E"] = "26000"
    # Total 45-64: 130k + 130k = 260k (26%)

    # Male 65+: cells 020-025 = ~11.67k each ≈ 70k
    for i in [20, 21, 22, 23, 24, 25]:
        row[f"B01001_{i:03d}E"] = "11667"
    # Female 65+: cells 044-049 = ~11.67k each ≈ 70k
    for i in [44, 45, 46, 47, 48, 49]:
        row[f"B01001_{i:03d}E"] = "11667"
    # Total 65+: ~70k + ~70k = ~140k (14%)

    # Convert to list matching header order
    return [row.get(var, "0") for var in AGE_VARIABLES] + ["06", "001"]


MOCK_AGE_JSON = [MOCK_AGE_HEADER, _build_age_row()]


# ── Mock data for Request 3: education ────────────────────────────────

MOCK_EDU_HEADER = list(EDUCATION_VARIABLES.keys()) + ["state", "county"]

MOCK_EDU_ROW = [
    "600000",   # B15003_001E edu_total
    "150000",   # B15003_017E hs_diploma
    "30000",    # B15003_018E ged
    "60000",    # B15003_019E some_college_lt1
    "90000",    # B15003_020E some_college_1plus
    "42000",    # B15003_021E associates
    "120000",   # B15003_022E bachelors
    "48000",    # B15003_023E masters
    "12000",    # B15003_024E professional
    "6000",     # B15003_025E doctorate
    "06",       # state
    "001",      # county (Alameda)
]

MOCK_EDU_JSON = [MOCK_EDU_HEADER, MOCK_EDU_ROW]


# ── Helpers ───────────────────────────────────────────────────────────

def _mock_responses():
    """Create three mock httpx responses: profile, age, education."""
    profile_resp = MagicMock()
    profile_resp.json.return_value = MOCK_PROFILE_JSON
    profile_resp.raise_for_status = MagicMock()

    age_resp = MagicMock()
    age_resp.json.return_value = MOCK_AGE_JSON
    age_resp.raise_for_status = MagicMock()

    edu_resp = MagicMock()
    edu_resp.json.return_value = MOCK_EDU_JSON
    edu_resp.raise_for_status = MagicMock()

    return [profile_resp, age_resp, edu_resp]


class TestFetchCountyDemographics:
    @patch("etl.census_api.httpx.get")
    def test_returns_parsed_rows_with_all_fields(self, mock_get):
        """Profile + age data merge into one dict per county."""
        mock_get.side_effect = _mock_responses()

        rows = fetch_county_demographics(year=2022, api_key="fake-key")

        assert len(rows) == 1
        row = rows[0]

        # Core fields
        assert row["county_fips"] == "001"
        assert row["population"] == 1000000
        assert row["median_age"] == 35.2
        assert row["median_income"] == 65000

        # Commute (500k / 800k = 62.5%)
        assert row["commute_drive_alone_pct"] == pytest.approx(62.5)
        assert row["commute_carpool_pct"] == pytest.approx(10.0)
        assert row["commute_wfh_pct"] == pytest.approx(8.75)

        # Race/Ethnicity
        assert row["pct_white"] == pytest.approx(40.0)
        assert row["pct_black"] == pytest.approx(6.0)
        assert row["pct_asian"] == pytest.approx(15.0)
        assert row["pct_hispanic"] == pytest.approx(35.0)
        assert row["pct_other_race"] == pytest.approx(4.0)

        # Poverty (108k / 900k = 12%)
        assert row["poverty_rate"] == pytest.approx(12.0)

        # Education
        # HS or higher = 150k+30k+60k+90k+42k+120k+48k+12k+6k = 558k / 600k = 93%
        assert row["pct_high_school_or_higher"] == pytest.approx(93.0)
        # Bachelor's+ = 120k+48k+12k+6k = 186k / 600k = 31%
        assert row["pct_bachelors_or_higher"] == pytest.approx(31.0)

        # Vehicle (28k / 400k = 7%)
        assert row["pct_no_vehicle"] == pytest.approx(7.0)

        # Housing (209k / 380k = 55%)
        assert row["pct_owner_occupied_housing"] == pytest.approx(55.0, abs=0.1)

        # Language
        assert row["pct_english_only"] == pytest.approx(60.0)
        assert row["pct_spanish_speaking"] == pytest.approx(30.0)

    @patch("etl.census_api.httpx.get")
    def test_age_distribution_percentages(self, mock_get):
        """Age brackets are computed from B01001 male+female cells."""
        mock_get.side_effect = _mock_responses()

        rows = fetch_county_demographics(year=2022, api_key="fake-key")
        row = rows[0]

        assert row["pct_under_18"] == pytest.approx(22.0)
        assert row["pct_18_24"] == pytest.approx(10.0)
        assert row["pct_25_44"] == pytest.approx(28.0)
        assert row["pct_45_64"] == pytest.approx(26.0)
        # 65+ = 11667*12 = 140004 / 1000000 ≈ 14%
        assert row["pct_65_plus"] == pytest.approx(14.0, abs=0.01)

    @patch("etl.census_api.httpx.get")
    def test_makes_three_api_requests(self, mock_get):
        """Should hit the Census API three times: profile + age + education."""
        mock_get.side_effect = _mock_responses()

        fetch_county_demographics(year=2022, api_key="fake-key")

        assert mock_get.call_count == 3

    @patch("etl.census_api.httpx.get")
    def test_uses_acs5_for_2010_and_later(self, mock_get):
        """ACS 5-year has full county coverage, used for 2010+."""
        mock_get.side_effect = _mock_responses()

        fetch_county_demographics(year=2015, api_key="fake-key")

        # Both requests should use acs5
        for c in mock_get.call_args_list:
            assert "/acs/acs5" in c[0][0]

    @patch("etl.census_api.httpx.get")
    def test_uses_acs1_for_2009_and_earlier(self, mock_get):
        """ACS 1-year is all that's available pre-2010."""
        mock_get.side_effect = _mock_responses()

        fetch_county_demographics(year=2009, api_key="fake-key")

        for c in mock_get.call_args_list:
            assert "/acs/acs1" in c[0][0]

    @patch("etl.census_api.httpx.get")
    def test_handles_null_values(self, mock_get):
        """ACS 1-year returns null for small counties — we store None."""
        null_profile = [
            MOCK_PROFILE_HEADER,
            [None] * len(PROFILE_VARIABLES) + ["06", "003"],
        ]
        null_age = [
            MOCK_AGE_HEADER,
            [None] * len(AGE_VARIABLES) + ["06", "003"],
        ]
        null_edu = [
            MOCK_EDU_HEADER,
            [None] * len(EDUCATION_VARIABLES) + ["06", "003"],
        ]
        null_profile_resp = MagicMock()
        null_profile_resp.json.return_value = null_profile
        null_profile_resp.raise_for_status = MagicMock()
        null_age_resp = MagicMock()
        null_age_resp.json.return_value = null_age
        null_age_resp.raise_for_status = MagicMock()
        null_edu_resp = MagicMock()
        null_edu_resp.json.return_value = null_edu
        null_edu_resp.raise_for_status = MagicMock()

        mock_get.side_effect = [null_profile_resp, null_age_resp, null_edu_resp]

        rows = fetch_county_demographics(year=2006, api_key="fake-key")

        assert len(rows) == 1
        assert rows[0]["population"] is None
        assert rows[0]["pct_white"] is None
        assert rows[0]["pct_under_18"] is None
        assert rows[0]["poverty_rate"] is None

    @patch("etl.census_api.httpx.get")
    def test_retries_on_server_error(self, mock_get):
        """Should retry up to 3 times on 500 errors, then raise."""
        mock_get.side_effect = httpx.HTTPStatusError(
            "500", request=MagicMock(), response=MagicMock(status_code=500)
        )

        with pytest.raises(httpx.HTTPStatusError):
            fetch_county_demographics(year=2022, api_key="fake-key")

        # First request retries 3 times, then raises
        assert mock_get.call_count == 3


class TestHelpers:
    def test_pct_normal(self):
        assert _pct(500, 1000) == 50.0

    def test_pct_zero_total(self):
        assert _pct(100, 0) is None

    def test_pct_none_inputs(self):
        assert _pct(None, 1000) is None
        assert _pct(100, None) is None

    def test_sum_cells_with_valid_data(self):
        record = {
            "B01001_003E": "10000",
            "B01001_004E": "20000",
            "B01001_005E": "15000",
        }
        assert _sum_cells(record, [3, 4, 5]) == 45000

    def test_sum_cells_all_none(self):
        record = {}
        assert _sum_cells(record, [3, 4, 5]) is None

"""Tests for the Census API client.

These use mocking — we fake the HTTP responses so tests don't hit
the real Census API. This makes tests fast, reliable, and free.

The client now makes 4 requests per year:
  1. Profile (population, income, race, commute, housing, language, per-capita
     income, travel time, foreign-born, rent burden, school enrollment, vets)
  2. Age distribution (B01001 sex-by-age cells, 5 brackets + sex totals)
  3. Education (B15003, optional — not available pre-2012 ACS5)
  4. Disability (B18101, optional — graceful skip on missing)
"""

import httpx
import pytest
from unittest.mock import patch, MagicMock

from etl.census_api import (
    fetch_county_demographics,
    AGE_VARIABLES,
    DISABILITY_VARIABLES,
    EDUCATION_VARIABLES,
    PROFILE_VARIABLES,
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
    "40000",    # B19301_001E per_capita_income
    "24000000", # B08013_001E travel_time_agg (24M minutes / 800K commute_total = 30 min mean)
    "1000000",  # B05002_001E birth_total
    "250000",   # B05002_013E birth_foreign (25%)
    "200000",   # B25070_001E rent_total
    "30000",    # B25070_007E rent 30-34.9%
    "20000",    # B25070_008E rent 35-39.9%
    "20000",    # B25070_009E rent 40-49.9%
    "30000",    # B25070_010E rent 50%+
    "950000",   # B14001_001E school_total (pop 3+)
    "247000",   # B14001_002E school_enrolled (26%)
    "700000",   # B21001_001E vet_total
    "70000",    # B21001_002E vet_veteran (10%)
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

    # Under-18: M cells 3-6 = 30k ea (120k); F cells 27-30 = 25k ea (100k) → 220k
    # 18-24: M cells 7-10 = 12.5k; F cells 31-34 = 12.5k → 100k
    # 25-44: M cells 11-14 = 35k; F cells 35-38 = 35k → 280k
    # 45-64: M cells 15-19 = 26k; F cells 39-43 = 26k → 260k
    # 65+:   M cells 20-25 = 11,667; F cells 44-49 = 11,667 → ~140k
    _bucket_values = [
        ([3, 4, 5, 6],              "30000"),
        ([27, 28, 29, 30],          "25000"),
        ([7, 8, 9, 10],             "12500"),
        ([31, 32, 33, 34],          "12500"),
        ([11, 12, 13, 14],          "35000"),
        ([35, 36, 37, 38],          "35000"),
        ([15, 16, 17, 18, 19],      "26000"),
        ([39, 40, 41, 42, 43],      "26000"),
        ([20, 21, 22, 23, 24, 25],  "11667"),
        ([44, 45, 46, 47, 48, 49],  "11667"),
    ]
    for cells, value in _bucket_values:
        for i in cells:
            row[f"B01001_{i:03d}E"] = value

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


# ── Mock data for Request 4: disability ───────────────────────────────

MOCK_DISABILITY_HEADER = DISABILITY_VARIABLES + ["state", "county"]

# Universe 1,000,000; "with a disability" cells total 100,000 (10%)
# 12 cells × ~8,333 each ≈ 100K
MOCK_DISABILITY_ROW = ["1000000"] + ["8333"] * 12 + ["06", "001"]

MOCK_DISABILITY_JSON = [MOCK_DISABILITY_HEADER, MOCK_DISABILITY_ROW]


# ── Helpers ───────────────────────────────────────────────────────────

def _mock_responses():
    """Create four mock httpx responses: profile, age, education, disability."""
    responses = []
    for payload in (MOCK_PROFILE_JSON, MOCK_AGE_JSON, MOCK_EDU_JSON, MOCK_DISABILITY_JSON):
        resp = MagicMock()
        resp.json.return_value = payload
        resp.raise_for_status = MagicMock()
        responses.append(resp)
    return responses


class TestFetchCountyDemographics:
    @patch("etl.census_api.httpx.get")
    def test_returns_parsed_rows_with_all_fields(self, mock_get):
        """Profile + age + disability data merge into one dict per county."""
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
        assert row["pct_high_school_or_higher"] == pytest.approx(93.0)
        assert row["pct_bachelors_or_higher"] == pytest.approx(31.0)

        # Vehicle / Housing / Language
        assert row["pct_no_vehicle"] == pytest.approx(7.0)
        assert row["pct_owner_occupied_housing"] == pytest.approx(55.0, abs=0.1)
        assert row["pct_english_only"] == pytest.approx(60.0)
        assert row["pct_spanish_speaking"] == pytest.approx(30.0)

        # New fields from this PR
        assert row["per_capita_income"] == 40000
        assert row["mean_travel_time_to_work"] == pytest.approx(30.0)  # 15M / 500K
        assert row["pct_foreign_born"] == pytest.approx(25.0)
        assert row["pct_rent_burdened"] == pytest.approx(50.0)  # 100K / 200K
        assert row["pct_enrolled_in_school"] == pytest.approx(26.0)  # 247K / 950K
        assert row["pct_veteran"] == pytest.approx(10.0)
        assert row["pct_with_disability"] == pytest.approx(10.0, abs=0.01)  # ~100K / 1M

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
        assert row["pct_65_plus"] == pytest.approx(14.0, abs=0.01)

    @patch("etl.census_api.httpx.get")
    def test_makes_four_api_requests(self, mock_get):
        """Should hit the Census API four times: profile + age + education + disability."""
        mock_get.side_effect = _mock_responses()

        fetch_county_demographics(year=2022, api_key="fake-key")

        assert mock_get.call_count == 4

    @patch("etl.census_api.httpx.get")
    def test_uses_acs5_for_2010_and_later(self, mock_get):
        """ACS 5-year has full county coverage, used for 2010+."""
        mock_get.side_effect = _mock_responses()

        fetch_county_demographics(year=2015, api_key="fake-key")

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
        null_disability = [
            MOCK_DISABILITY_HEADER,
            [None] * len(DISABILITY_VARIABLES) + ["06", "003"],
        ]
        resps = []
        for payload in (null_profile, null_age, null_edu, null_disability):
            r = MagicMock()
            r.json.return_value = payload
            r.raise_for_status = MagicMock()
            resps.append(r)
        mock_get.side_effect = resps

        rows = fetch_county_demographics(year=2006, api_key="fake-key")

        assert len(rows) == 1
        assert rows[0]["population"] is None
        assert rows[0]["pct_white"] is None
        assert rows[0]["pct_under_18"] is None
        assert rows[0]["poverty_rate"] is None
        assert rows[0]["per_capita_income"] is None
        assert rows[0]["pct_with_disability"] is None

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

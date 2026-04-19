"""Pull demographic data from the Census Bureau ACS API.

Gets ~36 fields per county per year — population, income, race/ethnicity,
age brackets, poverty, education, vehicle ownership, housing, language,
sex distribution, travel time, foreign-born share, rent burden, school
enrollment, veteran status, and disability rate. Uses the ACS 5-year
estimates for 2010+ (all 58 counties) and 1-year estimates for 2005-2009
(only covers counties over 65K population).

We make up to 4 API requests per year because the Census caps you at
50 variables per request:
  1. Profile — core + per-capita income, travel time, foreign-born,
     rent burden, school enrollment, veteran status (~38 variables)
  2. Age distribution — 47 cells from B01001 summed into 5 brackets +
     sex totals
  3. Education — B15003, but this table doesn't exist before 2012 in the
     5-year data so we just skip it gracefully for older years
  4. Disability — B18101 sex-by-age-by-disability (13 variables)
"""

import time
import logging

import httpx

logger = logging.getLogger(__name__)

# ── Request 1: demographic profile (24 variables) ──────────────────────

PROFILE_VARIABLES = {
    # Existing core fields
    "B01003_001E": "population",
    "B01002_001E": "median_age",
    "B19013_001E": "median_income",
    "B08006_001E": "commute_total",
    "B08006_003E": "commute_drive_alone",
    "B08006_004E": "commute_carpool",
    "B08006_008E": "commute_transit",
    "B08006_005E": "commute_walk",
    "B08006_014E": "commute_bike",
    "B08006_017E": "commute_wfh",
    # Race/Ethnicity (B03002 — Hispanic/Latino Origin by Race)
    "B03002_001E": "race_total",
    "B03002_003E": "race_white",        # White alone, not Hispanic
    "B03002_004E": "race_black",        # Black alone, not Hispanic
    "B03002_006E": "race_asian",        # Asian alone, not Hispanic
    "B03002_012E": "race_hispanic",     # Hispanic/Latino (any race)
    # Poverty (B17001 — Poverty Status in Past 12 Months)
    "B17001_001E": "poverty_total",     # Population for poverty determination
    "B17001_002E": "poverty_below",     # Income below poverty level
    # Household Vehicle Availability (B08201)
    "B08201_001E": "vehicle_total",     # Total households
    "B08201_002E": "vehicle_none",      # No vehicle available
    # Housing Tenure (B25003)
    "B25003_001E": "housing_total",     # Total occupied housing units
    "B25003_002E": "housing_owner",     # Owner-occupied
    # Language Spoken at Home (B16001 — available in all ACS years)
    "B16001_001E": "lang_total",        # Population 5 years and over
    "B16001_002E": "lang_english_only",
    "B16001_003E": "lang_spanish",
    # Per-capita income (B19301 — single value, no division needed)
    "B19301_001E": "per_capita_income",
    # Travel time to work: aggregate minutes / total workers 16+ who commuted.
    # Reuses B08006_001E (commute_total above) as the denominator — same
    # universe as B08301_001E but B08301 isn't published for ACS1 2005.
    "B08013_001E": "travel_time_agg",
    # Place of Birth (B05002 — foreign-born share)
    "B05002_001E": "birth_total",
    "B05002_013E": "birth_foreign",     # Foreign born
    # Gross Rent as % of Household Income (B25070 — rent-burdened %)
    "B25070_001E": "rent_total",        # Total renter households
    "B25070_007E": "rent_30_34",        # 30-34.9% of income in rent
    "B25070_008E": "rent_35_39",        # 35-39.9%
    "B25070_009E": "rent_40_49",        # 40-49.9%
    "B25070_010E": "rent_50_plus",      # 50%+ — severely cost-burdened
    # School Enrollment (B14001 — pop 3+)
    "B14001_001E": "school_total",
    "B14001_002E": "school_enrolled",
    # Veteran Status (B21001 — civilian pop 18+)
    "B21001_001E": "vet_total",
    "B21001_002E": "vet_veteran",
}

# ── Request 4: disability (13 variables) ──────────────────────────────
# B18101 — Sex by Age by Disability Status. We pull the total and the
# twelve "With a disability" cells (6 age brackets × 2 sexes), sum them,
# divide by total to get the overall disability rate.
DISABILITY_VARIABLES = [
    "B18101_001E",                       # total universe
    # Male "with a disability" cells (6 age brackets)
    "B18101_004E", "B18101_007E", "B18101_010E",
    "B18101_013E", "B18101_016E", "B18101_019E",
    # Female "with a disability" cells (6 age brackets)
    "B18101_023E", "B18101_026E", "B18101_029E",
    "B18101_032E", "B18101_035E", "B18101_038E",
]
_DISABILITY_WITH_CELLS = [
    "B18101_004E", "B18101_007E", "B18101_010E",
    "B18101_013E", "B18101_016E", "B18101_019E",
    "B18101_023E", "B18101_026E", "B18101_029E",
    "B18101_032E", "B18101_035E", "B18101_038E",
]

# ── Request 3 (optional): education (10 variables) ────────────────────
# B15003 — Educational Attainment for 25+
# Only available in ACS 5-year 2012+ and ACS 1-year 2008+.
# Fetched separately so earlier years still get all other data.
EDUCATION_VARIABLES = {
    "B15003_001E": "edu_total",
    "B15003_017E": "edu_hs_diploma",
    "B15003_018E": "edu_ged",
    "B15003_019E": "edu_some_college_lt1",
    "B15003_020E": "edu_some_college_1plus",
    "B15003_021E": "edu_associates",
    "B15003_022E": "edu_bachelors",
    "B15003_023E": "edu_masters",
    "B15003_024E": "edu_professional",
    "B15003_025E": "edu_doctorate",
}

# ── Request 2: age distribution (47 variables) ─────────────────────────
# B01001 — Sex by Age. We need male + female cells to compute brackets:
#   Under 18, 18-24, 25-44, 45-64, 65+

# Male age cells (B01001_003E through B01001_025E)
_MALE_CELLS = [f"B01001_{i:03d}E" for i in range(3, 26)]
# Female age cells (B01001_027E through B01001_049E)
_FEMALE_CELLS = [f"B01001_{i:03d}E" for i in range(27, 50)]
AGE_VARIABLES = ["B01001_001E"] + _MALE_CELLS + _FEMALE_CELLS  # 47 total

# Mapping of age bracket -> (male cell indices, female cell indices)
# These indices are the last 3 digits of the Census variable code.
AGE_BRACKETS = {
    "under_18": {
        "male": [3, 4, 5, 6],          # Under 5, 5-9, 10-14, 15-17
        "female": [27, 28, 29, 30],
    },
    "18_24": {
        "male": [7, 8, 9, 10],         # 18-19, 20, 21, 22-24
        "female": [31, 32, 33, 34],
    },
    "25_44": {
        "male": [11, 12, 13, 14],      # 25-29, 30-34, 35-39, 40-44
        "female": [35, 36, 37, 38],
    },
    "45_64": {
        "male": [15, 16, 17, 18, 19],  # 45-49, 50-54, 55-59, 60-61, 62-64
        "female": [39, 40, 41, 42, 43],
    },
    "65_plus": {
        "male": [20, 21, 22, 23, 24, 25],  # 65-66, 67-69, 70-74, 75-79, 80-84, 85+
        "female": [44, 45, 46, 47, 48, 49],
    },
}


MAX_RETRIES = 3
BACKOFF_BASE = 2  # seconds


def _safe_int(value):
    """Convert a Census string value to int. Returns None for nulls.

    The Census API returns numbers as strings ("1000000") or null.
    """
    if value is None or value == "":
        return None
    return int(value)


def _safe_float(value):
    """Convert a Census string value to float. Returns None for nulls."""
    if value is None or value == "":
        return None
    return float(value)


def _pct(count, total):
    """Calculate percentage from raw count and total.

    Example: 500,000 out of 800,000 = 62.5%
    """
    if count is None or total is None or total == 0:
        return None
    return round(count / total * 100, 2)


def _sum_cells(record, cell_numbers):
    """Sum Census cells by their 3-digit number, skipping nulls.

    Example: _sum_cells(record, [3, 4, 5, 6]) sums
    B01001_003E + B01001_004E + B01001_005E + B01001_006E
    """
    total = 0
    any_valid = False
    for num in cell_numbers:
        key = f"B01001_{num:03d}E"
        val = _safe_int(record.get(key))
        if val is not None:
            total += val
            any_valid = True
    return total if any_valid else None


def _fetch_with_retry(url: str) -> list:
    """Fetch Census API URL with retry + exponential backoff."""
    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = httpx.get(url, timeout=30.0)
            resp.raise_for_status()
            return resp.json()
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            last_error = exc
            if attempt < MAX_RETRIES - 1:
                wait = BACKOFF_BASE ** (attempt + 1)
                logger.warning(
                    "Attempt %d failed: %s. Retrying in %ds...",
                    attempt + 1, exc, wait,
                )
                time.sleep(wait)

    logger.error("All %d attempts failed", MAX_RETRIES)
    raise last_error


def _build_url(year: int, api_key: str, variables: str) -> str:
    """Build a Census API URL for CA counties."""
    dataset = "acs5" if year >= 2010 else "acs1"
    return (
        f"https://api.census.gov/data/{year}/acs/{dataset}"
        f"?get={variables}"
        f"&for=county:*&in=state:06"
        f"&key={api_key}"
    )


def _parse_response(data: list) -> list[dict]:
    """Parse Census JSON response into list of dicts keyed by variable code."""
    header = data[0]
    return [dict(zip(header, row)) for row in data[1:]]


def _process_profile(record: dict) -> dict:
    """Process a single county row from the profile request.

    Converts raw Census counts into the percentages we store.
    """
    population = _safe_int(record.get("B01003_001E"))
    median_age = _safe_float(record.get("B01002_001E"))
    median_income = _safe_int(record.get("B19013_001E"))

    # Commute modes
    commute_total = _safe_int(record.get("B08006_001E"))
    drive_alone = _safe_int(record.get("B08006_003E"))
    carpool = _safe_int(record.get("B08006_004E"))
    transit = _safe_int(record.get("B08006_008E"))
    walk = _safe_int(record.get("B08006_005E"))
    bike = _safe_int(record.get("B08006_014E"))
    wfh = _safe_int(record.get("B08006_017E"))

    # Race/Ethnicity
    race_total = _safe_int(record.get("B03002_001E"))
    race_white = _safe_int(record.get("B03002_003E"))
    race_black = _safe_int(record.get("B03002_004E"))
    race_asian = _safe_int(record.get("B03002_006E"))
    race_hispanic = _safe_int(record.get("B03002_012E"))
    # "Other" = total - white - black - asian - hispanic
    race_other = None
    if all(v is not None for v in [race_total, race_white, race_black, race_asian, race_hispanic]):
        race_other = race_total - race_white - race_black - race_asian - race_hispanic

    # Poverty
    poverty_total = _safe_int(record.get("B17001_001E"))
    poverty_below = _safe_int(record.get("B17001_002E"))

    # Vehicle availability
    vehicle_total = _safe_int(record.get("B08201_001E"))
    vehicle_none = _safe_int(record.get("B08201_002E"))

    # Housing tenure
    housing_total = _safe_int(record.get("B25003_001E"))
    housing_owner = _safe_int(record.get("B25003_002E"))

    # Language
    lang_total = _safe_int(record.get("B16001_001E"))
    lang_english = _safe_int(record.get("B16001_002E"))
    lang_spanish = _safe_int(record.get("B16001_003E"))

    # Per-capita income — direct from B19301
    per_capita_income = _safe_int(record.get("B19301_001E"))

    # Mean travel time to work (minutes) = aggregate minutes / workers 16+
    # who commute. Uses commute_total above (same universe as B08301).
    travel_agg = _safe_int(record.get("B08013_001E"))
    mean_travel_time = None
    if travel_agg is not None and commute_total is not None and commute_total > 0:
        mean_travel_time = round(travel_agg / commute_total, 2)

    # Foreign-born share
    birth_total = _safe_int(record.get("B05002_001E"))
    birth_foreign = _safe_int(record.get("B05002_013E"))

    # Rent burden — renters paying 30%+ of income (HUD definition)
    rent_total = _safe_int(record.get("B25070_001E"))
    rent_burdened_cells = [
        _safe_int(record.get(f"B25070_{i:03d}E")) for i in (7, 8, 9, 10)
    ]
    rent_burdened = None
    if any(v is not None for v in rent_burdened_cells):
        rent_burdened = sum(v for v in rent_burdened_cells if v is not None)

    # School enrollment (pop 3+)
    school_total = _safe_int(record.get("B14001_001E"))
    school_enrolled = _safe_int(record.get("B14001_002E"))

    # Veteran status (civilian pop 18+)
    vet_total = _safe_int(record.get("B21001_001E"))
    vet_veteran = _safe_int(record.get("B21001_002E"))

    return {
        "county_fips": record["county"],
        "population": population,
        "median_age": median_age,
        "median_income": median_income,
        "commute_drive_alone_pct": _pct(drive_alone, commute_total),
        "commute_carpool_pct": _pct(carpool, commute_total),
        "commute_transit_pct": _pct(transit, commute_total),
        "commute_walk_pct": _pct(walk, commute_total),
        "commute_bike_pct": _pct(bike, commute_total),
        "commute_wfh_pct": _pct(wfh, commute_total),
        "pct_white": _pct(race_white, race_total),
        "pct_black": _pct(race_black, race_total),
        "pct_asian": _pct(race_asian, race_total),
        "pct_hispanic": _pct(race_hispanic, race_total),
        "pct_other_race": _pct(race_other, race_total),
        "poverty_rate": _pct(poverty_below, poverty_total),
        "pct_high_school_or_higher": None,  # filled by education request
        "pct_bachelors_or_higher": None,    # filled by education request
        "pct_no_vehicle": _pct(vehicle_none, vehicle_total),
        "pct_owner_occupied_housing": _pct(housing_owner, housing_total),
        "pct_english_only": _pct(lang_english, lang_total),
        "pct_spanish_speaking": _pct(lang_spanish, lang_total),
        "per_capita_income": per_capita_income,
        "mean_travel_time_to_work": mean_travel_time,
        "pct_foreign_born": _pct(birth_foreign, birth_total),
        "pct_rent_burdened": _pct(rent_burdened, rent_total),
        "pct_enrolled_in_school": _pct(school_enrolled, school_total),
        "pct_veteran": _pct(vet_veteran, vet_total),
    }


def _process_age(record: dict) -> dict:
    """Process a single county row from the age distribution request.

    Sums male + female cells into 5 age brackets, then converts to percentages.
    Also computes total male / female percentages (sums across all age cells).
    """
    total_pop = _safe_int(record.get("B01001_001E"))

    brackets = {}
    for bracket_name, cells in AGE_BRACKETS.items():
        male_sum = _sum_cells(record, cells["male"])
        female_sum = _sum_cells(record, cells["female"])
        if male_sum is not None and female_sum is not None:
            brackets[bracket_name] = male_sum + female_sum
        elif male_sum is not None:
            brackets[bracket_name] = male_sum
        elif female_sum is not None:
            brackets[bracket_name] = female_sum
        else:
            brackets[bracket_name] = None

    # Sex totals — sum across all male age cells (3-25) and female age cells
    # (27-49). Used independently of the age brackets for sex distribution.
    all_male_cells = list(range(3, 26))
    all_female_cells = list(range(27, 50))
    male_total = _sum_cells(record, all_male_cells)
    female_total = _sum_cells(record, all_female_cells)

    return {
        "county_fips": record["county"],
        "pct_under_18": _pct(brackets["under_18"], total_pop),
        "pct_18_24": _pct(brackets["18_24"], total_pop),
        "pct_25_44": _pct(brackets["25_44"], total_pop),
        "pct_45_64": _pct(brackets["45_64"], total_pop),
        "pct_65_plus": _pct(brackets["65_plus"], total_pop),
        "pct_male": _pct(male_total, total_pop),
        "pct_female": _pct(female_total, total_pop),
    }


def _process_disability(record: dict) -> dict:
    """Process a single county row from the B18101 disability request.

    Sums the twelve "With a disability" cells (6 age brackets × 2 sexes)
    and divides by the total universe to get the overall disability rate.
    """
    total = _safe_int(record.get("B18101_001E"))
    with_disability_cells = [
        _safe_int(record.get(cell)) for cell in _DISABILITY_WITH_CELLS
    ]
    with_disability = None
    if any(v is not None for v in with_disability_cells):
        with_disability = sum(v for v in with_disability_cells if v is not None)

    return {
        "county_fips": record["county"],
        "pct_with_disability": _pct(with_disability, total),
    }


def _process_education(record: dict) -> dict:
    """Process a single county row from the education request.

    HS or higher = diploma + GED + any college + all degrees.
    Bachelor's or higher = bachelor's + master's + professional + doctorate.
    """
    edu_total = _safe_int(record.get("B15003_001E"))
    edu_hs_or_higher_parts = [
        _safe_int(record.get(f"B15003_{i:03d}E"))
        for i in range(17, 26)  # 017 through 025
    ]
    edu_bachelors_parts = [
        _safe_int(record.get(f"B15003_{i:03d}E"))
        for i in range(22, 26)  # 022 through 025
    ]
    edu_hs_sum = sum(v for v in edu_hs_or_higher_parts if v is not None) if any(v is not None for v in edu_hs_or_higher_parts) else None
    edu_ba_sum = sum(v for v in edu_bachelors_parts if v is not None) if any(v is not None for v in edu_bachelors_parts) else None

    return {
        "county_fips": record["county"],
        "pct_high_school_or_higher": _pct(edu_hs_sum, edu_total),
        "pct_bachelors_or_higher": _pct(edu_ba_sum, edu_total),
    }


def fetch_county_demographics(year: int, api_key: str) -> list[dict]:
    """Fetch demographic data for all CA counties for a given year.

    Makes up to 3 API requests (Census caps at 50 variables per request):
      1. Profile: population, income, commute, race, poverty, vehicle,
         housing, language
      2. Age distribution: 47 sex-by-age cells from B01001
      3. Education (optional): B15003 — only available 2012+ for ACS 5-year

    Picks the right ACS dataset:
    - 2010+: ACS 5-year (covers all counties, most reliable)
    - 2005-2009: ACS 1-year (only covers counties with 65k+ population)

    Returns a list of dicts with keys matching the Demographic model,
    plus 'county_fips' (3-digit FIPS code like "001" for Alameda).
    """
    logger.info("Fetching Census ACS data for %d", year)

    # Request 1: demographic profile
    profile_codes = ",".join(PROFILE_VARIABLES.keys())
    profile_url = _build_url(year, api_key, profile_codes)
    profile_data = _fetch_with_retry(profile_url)
    profile_rows = _parse_response(profile_data)

    # Request 2: age distribution
    age_codes = ",".join(AGE_VARIABLES)
    age_url = _build_url(year, api_key, age_codes)
    age_data = _fetch_with_retry(age_url)
    age_rows = _parse_response(age_data)

    # Request 3 (optional): education — B15003 not available pre-2012 ACS5
    edu_by_fips = {}
    try:
        edu_codes = ",".join(EDUCATION_VARIABLES.keys())
        edu_url = _build_url(year, api_key, edu_codes)
        edu_data = _fetch_with_retry(edu_url)
        edu_rows = _parse_response(edu_data)
        for row in edu_rows:
            edu_result = _process_education(row)
            edu_by_fips[edu_result["county_fips"]] = edu_result
    except (httpx.HTTPStatusError, httpx.RequestError):
        logger.info("Education data (B15003) not available for %d — skipping", year)

    # Request 4 (optional): disability — B18101. Skip gracefully if absent.
    disability_by_fips = {}
    try:
        disability_codes = ",".join(DISABILITY_VARIABLES)
        disability_url = _build_url(year, api_key, disability_codes)
        disability_data = _fetch_with_retry(disability_url)
        disability_rows = _parse_response(disability_data)
        for row in disability_rows:
            disability_result = _process_disability(row)
            disability_by_fips[disability_result["county_fips"]] = disability_result
    except (httpx.HTTPStatusError, httpx.RequestError):
        logger.info("Disability data (B18101) not available for %d — skipping", year)

    # Build lookup for age data by county FIPS
    age_by_fips = {}
    for row in age_rows:
        age_result = _process_age(row)
        age_by_fips[age_result["county_fips"]] = age_result

    # Merge profile + age + education into final results
    results = []
    for row in profile_rows:
        profile_result = _process_profile(row)
        fips = profile_result["county_fips"]

        # Merge in age data if available
        age_result = age_by_fips.get(fips, {})
        profile_result.update({
            "pct_under_18": age_result.get("pct_under_18"),
            "pct_18_24": age_result.get("pct_18_24"),
            "pct_25_44": age_result.get("pct_25_44"),
            "pct_45_64": age_result.get("pct_45_64"),
            "pct_65_plus": age_result.get("pct_65_plus"),
            "pct_male": age_result.get("pct_male"),
            "pct_female": age_result.get("pct_female"),
        })

        # Merge in education data if available
        edu_result = edu_by_fips.get(fips, {})
        if edu_result:
            profile_result["pct_high_school_or_higher"] = edu_result.get("pct_high_school_or_higher")
            profile_result["pct_bachelors_or_higher"] = edu_result.get("pct_bachelors_or_higher")

        # Merge in disability data if available
        disability_result = disability_by_fips.get(fips, {})
        if disability_result:
            profile_result["pct_with_disability"] = disability_result.get("pct_with_disability")

        results.append(profile_result)

    logger.info("Fetched %d county rows for %d", len(results), year)
    return results

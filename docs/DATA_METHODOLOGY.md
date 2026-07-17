# CalSight Data Methodology

**Version:** 1.0
**Last Updated:** May 2026
**Authors:** Jeffrey Sardella (Sacramento State, CSC 177)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Data Sources](#2-data-sources)
3. [ETL Pipeline Architecture](#3-etl-pipeline-architecture)
4. [Data Processing Methodology](#4-data-processing-methodology)
5. [Derived Metrics and Formulas](#5-derived-metrics-and-formulas)
6. [Statistical Methods](#6-statistical-methods)
7. [Data Quality and Limitations](#7-data-quality-and-limitations)
8. [Update Schedule](#8-update-schedule)
9. [Privacy and Ethics](#9-privacy-and-ethics)
10. [Reproducibility](#10-reproducibility)
11. [References](#11-references)

---

## 1. Overview

CalSight is a California traffic safety analytics platform that integrates 15 public data sources into a unified analytical database. The platform enables county-level comparative analysis of crash patterns alongside socioeconomic, environmental, transportation, and weather data across all 58 California counties from 2001 to the present.

The data pipeline ingests approximately 25 million rows from federal and state agencies, transforms them through a multi-stage ETL (Extract, Transform, Load) process, and surfaces the results through a REST API and interactive dashboard. All source data is publicly available under government open-data mandates.

### System Architecture

```
Public APIs/Archives --> ETL Pipeline --> PostgreSQL --> FastAPI --> React Dashboard
(15 sources)           (Python)         (25M+ rows)    (REST)     (TypeScript)
```

The pipeline is orchestrated by a dependency-aware job scheduler that resolves execution order via topological sort on a directed acyclic graph (DAG) of job dependencies. Tier 1 jobs load external data with no dependencies; Tier 2 jobs compute derived fields and refresh materialized views.

---

## 2. Data Sources

### 2.1 CCRS (California Crash Reporting System)

| Attribute | Value |
|---|---|
| **Official Name** | California Crash Reporting System (CCRS) |
| **Source Agency** | California Highway Patrol (CHP) |
| **Legal Authority** | California Public Records Act (Gov. Code 6250-6270); California Vehicle Code 20008 (mandatory crash reporting) |
| **URL** | https://data.ca.gov/dataset/california-crash-reporting-system |
| **API Endpoint** | `https://data.ca.gov/api/3/action/datastore_search` |
| **Coverage** | 2016 -- present |
| **Update Frequency** | Daily (CKAN DataStore) |
| **Row Count** | ~4.35 million crash records |

**Fields Extracted:**
Collision ID, crash date/time, day of week, county code, city name, latitude, longitude, collision type description, primary collision factor violation, motor vehicle involved with, number killed, number injured, weather condition, road condition, lighting, highway/freeway flags, primary/secondary road names, hit-and-run status, pedestrian action code.

**CKAN Resource IDs (per year):** Each year has a dedicated resource ID (e.g., 2024: `f775df59-b89b-4f82-bd3d-8807fa3a22a0`, 2026: `b8ce0ca4-b4e9-490d-b4d1-1f4ec48cbefb`). The ETL paginates through the CKAN DataStore Search API at 32,000 records per page with exponential-backoff retry logic.

**Notes:** CCRS replaced SWITRS as CHP's primary reporting system in 2016. Field names use inconsistent casing (e.g., `"Crash Date Time"`, `"NumberKilled"`, `"PedestrianActionCode"`). The ETL normalizes all fields to a consistent schema. Datetime formats vary across years: newer years use ISO format (`2022-01-01T00:00:00`), while 2016-2017 use US format (`1/18/2017 8:20:00 PM`).

### 2.2 CCRS Parties (At-Fault Drivers, Pedestrians, Cyclists)

| Attribute | Value |
|---|---|
| **Official Name** | CCRS Parties Dataset |
| **Source Agency** | California Highway Patrol (CHP) |
| **Legal Authority** | California Public Records Act |
| **URL** | https://data.ca.gov/dataset/california-crash-reporting-system |
| **Coverage** | 2016 -- present |
| **Update Frequency** | Daily |
| **Row Count** | ~8.8 million party records |

**Fields Extracted:**
Party ID, collision ID, party number, party type (Driver/Pedestrian/Bicyclist), at-fault flag, gender code, stated age, sobriety/drug status, vehicle type/year/make, posted speed limit, movement description, safety equipment, cell phone use.

**Notes:** Links to crashes via `(collision_id, data_source)`. One crash can involve multiple parties. This table powers demographic analysis: at-fault driver age/gender distributions, DUI detection, distracted driving flags.

### 2.3 CCRS Victims (Injured/Witness/Passengers)

| Attribute | Value |
|---|---|
| **Official Name** | CCRS InjuredWitnessPassengers Dataset |
| **Source Agency** | California Highway Patrol (CHP) |
| **Legal Authority** | California Public Records Act |
| **URL** | https://data.ca.gov/dataset/california-crash-reporting-system |
| **Coverage** | 2016 -- present |
| **Update Frequency** | Daily |
| **Row Count** | ~5.3 million victim records |

**Fields Extracted:**
Victim ID, collision ID, party number, age, gender, injury severity code, person type, seat position, safety equipment, ejection status.

**Notes:** Victim-level records enable injury severity analysis beyond what the crash-level `number_killed` / `number_injured` fields provide.

### 2.4 SWITRS (Statewide Integrated Traffic Records System)

| Attribute | Value |
|---|---|
| **Official Name** | SWITRS Historical Collision Database |
| **Source Agency** | California Highway Patrol (CHP) |
| **Legal Authority** | California Public Records Act |
| **URL** | https://zenodo.org/records/4284843 |
| **Coverage** | 2001 -- 2015 |
| **Update Frequency** | Static (historical archive) |
| **Row Count** | ~6.78 million crash records |

**Fields Extracted:**
Case ID, collision date/time, county-city location code, latitude, longitude, type of collision, PCF violation category, motor vehicle involved with, killed/injured counts, weather, road surface, lighting, highway indicator, primary/secondary road, hit-and-run, pedestrian action.

**Data Format:** Gzip-compressed SQLite database inside a ZIP archive hosted on Zenodo (CERN's open-data repository). The ETL downloads the archive once per run, extracts the SQLite file, and queries it by year. Column names use lowercase_with_underscores format. County codes are derived from the first 2 digits of the `county_city_location` field.

**Notes:** SWITRS is CHP's legacy system. No party or victim detail tables exist for SWITRS years, so demographic flags (alcohol involvement, distraction, cyclist/pedestrian) are set to NULL for pre-2016 crashes. SWITRS and CCRS use overlapping numeric collision ID spaces -- the pair `(collision_id, data_source)` is the true unique key.

### 2.5 U.S. Census Bureau -- American Community Survey (ACS)

| Attribute | Value |
|---|---|
| **Official Name** | American Community Survey (ACS) 5-Year and 1-Year Estimates |
| **Source Agency** | U.S. Census Bureau |
| **Legal Authority** | Title 13, U.S. Code; Freedom of Information Act (5 U.S.C. 552) |
| **URL** | https://api.census.gov/data/ |
| **Coverage** | 2005 -- 2022 (all 58 CA counties for 2010+; counties >65K pop for 2005-2009) |
| **Update Frequency** | Annual (ACS releases typically in December) |
| **Row Count** | ~1,012 demographic records (58 counties x ~18 years) |

**Fields Extracted (36 total):**

| Category | Census Tables | CalSight Fields |
|---|---|---|
| Core | B01003, B01002, B19013 | population, median_age, median_income |
| Economic | B19301, B17001 | per_capita_income, poverty_rate |
| Race/Ethnicity | B03002 | pct_white, pct_black, pct_asian, pct_hispanic, pct_other_race |
| Age Distribution | B01001 (47 cells) | pct_under_18, pct_18_24, pct_25_44, pct_45_64, pct_65_plus |
| Sex | B01001 | pct_male, pct_female |
| Commute | B08006, B08013 | commute_drive_alone_pct, commute_carpool_pct, commute_transit_pct, commute_walk_pct, commute_bike_pct, commute_wfh_pct, mean_travel_time_to_work |
| Education | B15003 | pct_high_school_or_higher, pct_bachelors_or_higher |
| Housing/Transport | B08201, B25003, B25070 | pct_no_vehicle, pct_owner_occupied_housing, pct_rent_burdened |
| Language | B16001 | pct_english_only, pct_spanish_speaking |
| Equity | B05002, B14001, B21001, B18101 | pct_foreign_born, pct_enrolled_in_school, pct_veteran, pct_with_disability |

**API Behavior:** The Census API caps requests at 50 variables, so each county-year requires 4 API calls: (1) demographic profile, (2) age distribution (47 sex-by-age cells from B01001), (3) education (B15003, available 2012+), (4) disability (B18101 sex-by-age-by-disability, 13 variables). The ETL selects ACS 5-year estimates for 2010+ and 1-year estimates for 2005-2009. Requires a free Census API key.

### 2.6 NOAA Climate Data Online

| Attribute | Value |
|---|---|
| **Official Name** | Global Summary of the Month (GSOM) |
| **Source Agency** | NOAA National Centers for Environmental Information (NCEI) |
| **Legal Authority** | Freedom of Information Act (5 U.S.C. 552); NOAA Open Data Policy |
| **URL** | https://www.ncei.noaa.gov/cdo-web/ |
| **API Endpoint** | `https://www.ncei.noaa.gov/cdo-web/api/v2/data` |
| **Coverage** | 2001 -- 2025, monthly per county |
| **Update Frequency** | Monthly |
| **Row Count** | ~17,300 weather records |

**Fields Extracted:**
Average temperature (TAVG), maximum temperature (TMAX), minimum temperature (TMIN), total precipitation (PRCP). All in standard units (Fahrenheit, inches).

**Aggregation Method:** NOAA provides station-level data. Multiple weather stations report per county per month. The ETL averages temperature readings across all stations within each county for each month and averages precipitation readings, producing one row per county per month.

**Rate Limits:** 5 requests/second, 10,000 requests/day. The ETL queries one county at a time with a 0.3-second delay between requests. Requires a free NOAA CDO API token.

### 2.7 Bureau of Labor Statistics (BLS) -- Local Area Unemployment Statistics

| Attribute | Value |
|---|---|
| **Official Name** | Local Area Unemployment Statistics (LAUS) |
| **Source Agency** | U.S. Bureau of Labor Statistics |
| **Legal Authority** | Freedom of Information Act; 29 U.S.C. 2 (BLS enabling legislation) |
| **URL** | https://www.bls.gov/lau/ |
| **API Endpoint** | `https://api.bls.gov/publicAPI/v2/timeseries/data/` |
| **Coverage** | 2005 -- 2025, monthly per county |
| **Update Frequency** | Monthly |
| **Row Count** | ~14,558 unemployment records |

**Fields Extracted:**
Monthly unemployment rate (percentage) per county. Series ID format: `LAUCN{5-digit FIPS}0000000003` (the `03` suffix specifies "unemployment rate").

**API Behavior:** BLS allows up to 50 series and 20 years per request. For 58 counties, the ETL sends 2 batches (50 + 8 counties) per 20-year window. Annual average entries (period `M13`) are excluded; only monthly values (M01-M12) are retained. Requires a free BLS API key.

### 2.8 CA DMV -- Vehicle Fuel Type Count

| Attribute | Value |
|---|---|
| **Official Name** | Vehicle Fuel Type Count by Zip Code |
| **Source Agency** | California Department of Motor Vehicles (DMV) |
| **Legal Authority** | California Public Records Act |
| **URL** | https://data.ca.gov/dataset/vehicle-fuel-type-count-by-zip-code |
| **Coverage** | 2019 -- 2026 |
| **Update Frequency** | Annual |
| **Row Count** | ~464 county-year records |

**Fields Extracted:**
Total registered vehicles and electric vehicle count (Battery Electric + Plug-in Hybrid) per county per year.

**Aggregation Method:** The raw data has one row per (zip code, model year, fuel type, make, duty class). The ETL sums all vehicle records per zip code, maps zip codes to counties using the Census Bureau's 2020 ZCTA-to-County relationship file (`tab20_zcta520_county20_natl.txt`), and aggregates to county-level totals. Each zip code is assigned to the county containing the largest share of its land area.

### 2.9 CA DMV -- Licensed Drivers Outstanding

| Attribute | Value |
|---|---|
| **Official Name** | Driver Licenses Outstanding by County |
| **Source Agency** | California Department of Motor Vehicles (DMV) |
| **Legal Authority** | California Public Records Act |
| **URL** | https://data.ca.gov/dataset/driver-licenses-outstanding-by-county |
| **CKAN Resource ID** | `0abef7f0-285f-4887-9b4e-69e86d89ceb1` |
| **Coverage** | 2008 -- 2024 |
| **Update Frequency** | Annual |
| **Row Count** | ~969 county-year records |

**Fields Extracted:**
Licensed driver count per county per year. The source dataset is wide-format (each year is a column), which the ETL pivots to long-format rows. Summary rows (TOTAL, OUT OF STATE, ID CARDS OUTSTANDING) are filtered out.

### 2.10 Caltrans -- Annual Average Daily Traffic (AADT)

| Attribute | Value |
|---|---|
| **Official Name** | Traffic Census Program -- AADT |
| **Source Agency** | California Department of Transportation (Caltrans) |
| **Legal Authority** | California Public Records Act |
| **URL** | https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/Traffic_AADT/FeatureServer |
| **Coverage** | Current year (point-in-time snapshot of all state highway segments) |
| **Update Frequency** | Monthly refresh |
| **Row Count** | 58 county records (aggregated from ~14,000 road segments) |

**Fields Extracted:**
County abbreviation (CNTY), ahead-direction AADT (AHEAD_AADT), route, and description per road segment.

**Aggregation Method:** The raw data contains one row per road segment on state highways. The ETL maps Caltrans 2-3 letter county abbreviations to county codes, sums AHEAD_AADT across all segments per county, and produces per-county totals: total AADT, segment count, and average AADT per segment.

### 2.11 Caltrans -- Public Road Functional Classification

| Attribute | Value |
|---|---|
| **Official Name** | Public Road Functional Classification |
| **Source Agency** | California Department of Transportation (Caltrans) |
| **Legal Authority** | California Public Records Act |
| **URL** | https://data.ca.gov/dataset/public-road-functional-classification |
| **CKAN Resource ID** | `5180390d-e323-4751-8ce9-939e62918233` |
| **Coverage** | Current (point-in-time, ~780,000 road segments) |
| **Update Frequency** | Monthly refresh |
| **Row Count** | ~355 county-by-road-type records |

**Fields Extracted:**
County label, FHWA Functional System classification (1=Interstate through 7=Local), segment count, and total road miles per county per road type.

**Aggregation Method:** Uses CKAN's server-side SQL endpoint to execute a GROUP BY query remotely, avoiding the download of 780K raw segments. Segment lengths are stored in meters (Web Mercator projection, EPSG:3857) and converted to miles by dividing by 1,609.344. Projection distortion at California's latitude introduces approximately 2-5% error, which is acceptable for county-to-county comparison.

### 2.12 FHWA -- Highway Performance Monitoring System (HPMS) Speed Limits

| Attribute | Value |
|---|---|
| **Official Name** | Highway Performance Monitoring System (HPMS) Full California 2022 |
| **Source Agency** | Federal Highway Administration (FHWA), U.S. Department of Transportation |
| **Legal Authority** | 23 U.S.C. 303 (HPMS enabling statute); Freedom of Information Act |
| **URL** | https://geo.dot.gov/server/rest/services/Hosted/HPMS_Full_CA_2022/FeatureServer |
| **Coverage** | 2022 (most recent published year) |
| **Update Frequency** | Annual |
| **Row Count** | ~171 county-by-speed-limit records (aggregated from ~120,000 segments) |

**Fields Extracted:**
Speed limit (posted mph), county ID, through-lanes, AADT per road segment. Aggregated to (county, speed_limit) pairs with segment count, average lane count, and total AADT.

### 2.13 CA HCAI -- Licensed Healthcare Facilities (Hospitals)

| Attribute | Value |
|---|---|
| **Official Name** | Licensed and Certified Healthcare Facility Listing |
| **Source Agency** | California Health Care Access and Information (HCAI), formerly OSHPD |
| **Legal Authority** | California Public Records Act; Health and Safety Code 1250-1264 |
| **URL** | https://data.ca.gov/dataset/licensed-and-certified-healthcare-facility-listing |
| **CKAN Resource ID** | `3d2503d7-56ad-4f38-8435-3d86d27b7407` |
| **Coverage** | Current licensed facilities |
| **Update Frequency** | Monthly |
| **Row Count** | ~560 hospital records |

**Fields Extracted:**
Facility ID, facility name, facility type, county, city, address, latitude, longitude, bed capacity, trauma center level, pediatric trauma level, operating status.

**Filter Criteria:** Only General Acute Care Hospitals, Acute Psychiatric Hospitals, and Acute Care Children's Hospitals are retained. Nursing homes, clinics, and other facility types are excluded. Enables proximity-to-trauma-center analysis.

### 2.14 CA Department of Education -- School Locations

| Attribute | Value |
|---|---|
| **Official Name** | California Public Schools 2024-25 |
| **Source Agency** | California Department of Education (CDE) |
| **Legal Authority** | California Public Records Act; Education Code 33126 |
| **URL** | https://data.ca.gov/dataset/california-public-schools |
| **CKAN Resource ID** | `23740f30-e860-4ada-a7cb-8de6d21e2c78` |
| **Coverage** | 2024-25 academic year |
| **Update Frequency** | Annual |
| **Row Count** | ~9,932 active school records |

**Fields Extracted:**
CDS Code (County-District-School), school name, county, city, latitude, longitude, school type, status.

**Filter Criteria:** Only records with `Status = "Active"` are retained. Enables "crashes near schools" spatial analysis and school-zone safety metrics.

### 2.15 CalEnviroScreen 5.0

| Attribute | Value |
|---|---|
| **Official Name** | CalEnviroScreen 5.0 |
| **Source Agency** | California Office of Environmental Health Hazard Assessment (OEHHA) |
| **Legal Authority** | California Public Records Act; SB 535 (Disadvantaged Communities); AB 1550 |
| **URL** | https://oehha.ca.gov/calenviroscreen |
| **API Endpoint** | `https://services1.arcgis.com/PCHfdHz4GlDNAhBb/arcgis/rest/services/calenviroscreen50results_F_070126_gdb/FeatureServer` |
| **Coverage** | Point-in-time (based on ACS 2024 population data, 2020 census tract geography) |
| **Update Frequency** | Updated with each major CES version release (CES 5.0 published 2026-07-01) |
| **Row Count** | 58 county records (aggregated from ~9,100 census tracts) |

**Fields Extracted:**
CES composite score, CES percentile, pollution burden score, population characteristics score, PM2.5, ozone, diesel particulate matter, pesticide use, traffic proximity, poverty rate, unemployment rate, education (% without HS diploma), linguistic isolation, housing burden.

**Aggregation Method:** The raw data is at census tract level (~9,100 tracts in California, on 2020 census geography). CalSight aggregates to county level using **population-weighted averaging**:

```
county_score = SUM(tract_score * tract_population) / SUM(tract_population)
```

Census tract FIPS codes are 11 digits; the first 5 identify the county (e.g., `06001` = Alameda County). Some tract codes arrive as 10-digit numbers (missing leading zero) and are zero-padded by the ETL. Only tracts with population > 0 contribute to the weighted average.

---

## 3. ETL Pipeline Architecture

### 3.1 Orchestration

The pipeline uses a custom Python-based orchestrator (`etl/orchestrator.py`) that models jobs as a directed acyclic graph (DAG). Each job specifies:

- **name:** Unique identifier
- **module:** Python module to execute
- **depends_on:** List of prerequisite job names
- **schedule:** `"daily"`, `"monthly"`, or `"static"` (one-time loads)
- **max_drop_pct:** Maximum acceptable row count decrease between runs (safety guardrail)
- **source_type:** `"ckan"`, `"arcgis"`, `"federal"`, or `"none"` (for freshness checking)

Execution order is resolved via topological sort. The pipeline runs daily at 3 AM Pacific (10 AM UTC) via APScheduler cron trigger.

### 3.2 Two-Tier Architecture

**Tier 1: External Data Loads (no inter-job dependencies)**

| Job Name | Source | Table | Schedule |
|---|---|---|---|
| `crashes_switrs` | Zenodo archive | `crashes` | Static |
| `crashes_ccrs` | data.ca.gov CKAN | `crashes` | Daily |
| `parties` | data.ca.gov CKAN | `crash_parties` | Daily |
| `victims` | data.ca.gov CKAN | `crash_victims` | Daily |
| `demographics` | Census API | `demographics` | Monthly |
| `weather` | NOAA CDO API | `weather` | Monthly |
| `hospitals` | data.ca.gov CKAN | `hospitals` | Monthly |
| `schools` | data.ca.gov CKAN | `school_locations` | Monthly |
| `speed_limits` | FHWA ArcGIS | `speed_limits` | Monthly |
| `aadt` | Caltrans ArcGIS | `caltrans_aadt` | Monthly |
| `vehicles` | data.ca.gov CKAN | `dmv_vehicles` | Monthly |
| `unemployment` | BLS API | `unemployment_rates` | Monthly |
| `calenviroscreen` | OEHHA ArcGIS | `calenviroscreen` | Monthly |
| `licensed_drivers` | data.ca.gov CKAN | `licensed_drivers` | Monthly |
| `road_miles` | data.ca.gov CKAN | `road_miles` | Monthly |

**Tier 2: Internal Transforms (depend on Tier 1 completions)**

| Job Name | Depends On | Purpose |
|---|---|---|
| `backfill` | crashes_ccrs, parties | Derive crash_hour, severity, alcohol/drug/distraction flags, canonical_cause, county_name, at-fault driver age |
| `backfill_conditions` | backfill | Canonicalize weather, lighting, road_condition, collision_type |
| `data_quality` | backfill, backfill_conditions | Compute fill-rate statistics per county per year |
| `validate_coords` | crashes_ccrs | Flag lat/lng outside county boundaries |
| `matviews` | backfill, data_quality, demographics, licensed_drivers, vehicles, road_miles, aadt | Refresh 8 materialized views |
| `insights` | matviews | Generate per-county AI narrative insight cards |
| `vacuum` | matviews, insights | PostgreSQL VACUUM ANALYZE for query planner |

### 3.3 Idempotency and Upsert Strategy

All data loads use **upsert** semantics (INSERT ... ON CONFLICT DO UPDATE) via PostgreSQL's native conflict resolution. This makes every ETL job safe to re-run: re-executing produces the same result without duplicate rows. Crash records are keyed on `(collision_id, data_source)`, parties on `(party_id, data_source)`, victims on `(victim_id, data_source)`, and reference tables on their natural keys (e.g., `(county_code, year)` for demographics).

### 3.4 Error Handling and Resilience

- **Retry with exponential backoff:** All HTTP requests retry up to 3 times with 2^n second delays (2s, 4s, 8s).
- **Batch-level rollback:** If a batch of crash records fails to upsert, only that batch is rolled back. The ETL continues with the next batch.
- **Year-level isolation:** Each year's data is loaded independently. A failure for 2023 does not prevent 2024 from loading.
- **Run tracking:** Every ETL execution is recorded in the `etl_runs` table with status, row counts, timing, and error messages.

---

## 4. Data Processing Methodology

### 4.1 Source Routing (SWITRS vs. CCRS)

Crash data is partitioned by year:
- **2001-2015:** SWITRS (historical archive from Zenodo)
- **2016-present:** CCRS (live API from data.ca.gov)

This boundary reflects CHP's migration from SWITRS to CCRS in 2016. The two systems use overlapping collision ID numbering, so the compound key `(collision_id, data_source)` is required for all joins.

### 4.2 Canonical Cause Classification

The raw `primary_factor` field contains approximately 12,500 distinct values -- a mix of plain English descriptions and California Vehicle Code section numbers. The ETL collapses these into 10 canonical categories using ordered regex rules (first match wins):

| Category | Regex Pattern | Examples |
|---|---|---|
| `dui` | `dui` (word boundary) or `23152` | "DUI", "VC 23152(A)" |
| `speeding` | `speed` or `22350` | "Unsafe Speed", "VC 22350" |
| `signal_violation` | `traffic signal`, `red light`, `stop sign`, `21453`, `22450` | "Ran Red Light", "VC 22450" |
| `right_of_way` | `right of way`, `21800-21806` | "Automobile ROW" |
| `turning` | `improper turn`, `22107`, `22100-22105` | "Improper Turning" |
| `following_too_close` | `follow.*clos`, `21703` | "Following Too Closely" |
| `pedestrian_violation` | `pedestrian`, `21950-21956` | "Pedestrian Violation" |
| `unsafe_backing` | `unsafe.*(start\|back)`, `22106` | "Unsafe Starting/Backing" |
| `lane_change` | `lane change`, `improper passing`, `21658`, `21650` | "Improper Passing" |
| `other` | Everything else | "Unknown", miscellaneous codes |

The classification runs on the ~12K distinct values (not 11M rows), loads results into a PostgreSQL temp table, and applies via a hash join UPDATE -- approximately 100x faster than per-row regex evaluation.

### 4.3 Canonical Condition Classification

Four free-text condition fields are similarly canonicalized:

**Weather** (`canonical_weather`): clear, cloudy, rain, fog, snow, wind, other

**Lighting** (`canonical_lighting`): daylight, dusk_dawn, dark_lit, dark_unlit, other

**Road Condition** (`canonical_road_condition`): dry, wet, snow_ice, construction, other

**Collision Type** (`canonical_collision_type`): rear_end, broadside, sideswipe, hit_object, head_on, other

### 4.4 Severity Classification

Pre-computed from crash-level kill/injury counts:

| Severity | Rule |
|---|---|
| `Fatal` | `number_killed > 0` |
| `Injury` | `number_killed = 0 AND number_injured > 0` |
| `Property Damage Only` | `number_killed = 0 AND number_injured = 0` |

### 4.5 Involvement Flags (CCRS 2016+ Only)

Crash-level boolean flags are derived from the `crash_parties` table to enable fast dashboard filtering without joining to the 8.8M-row parties table:

| Flag | Detection Rule |
|---|---|
| `is_alcohol_involved` | Any party with sobriety = `'HBD-UNDER INFLUENCE'` or `'UNDER_DRUG_INFLUENCE'` |
| `is_drug_involved` | Any party with sobriety = `'UNDER_DRUG_INFLUENCE'` |
| `is_distraction_involved` | Any party with cell_phone_use containing `'HANDHELD IN USE'` or `'HANDSFREE IN USE'` |
| `pedestrian_involved` | Any party with party_type = `'Pedestrian'` |
| `cyclist_involved` | Any party with party_type = `'Bicyclist'` |
| `at_fault_driver_age` | Age of the at-fault driver (party_type='Driver', at_fault=TRUE); youngest if multiple |

**Validation against national benchmarks:** The alcohol detection rule yields ~8.9% of crashes flagged, consistent with NHTSA national averages. The distraction detection rule yields ~2.5%, also consistent with NHTSA estimates. Alternative sobriety field values (e.g., `'IMPAIRMENT_NOT_KNOWN'`, `'SLEEPY/FATIGUED'`) were tested but produced implausibly high rates (>40%).

### 4.6 Temporal Field Extraction

To avoid repeated `EXTRACT()` calls on 11M+ datetime values, the ETL pre-computes:
- `crash_hour` (0-23) from `crash_datetime`
- `crash_year` (integer) from `crash_datetime`
- `crash_month` (1-12) from `crash_datetime`
- `day_of_week_num` (0=Monday through 6=Sunday, ISO day of week minus 1)

### 4.7 Population Density

Derived field computed during backfill:

```
population_density = population / land_area_sq_miles
```

Land areas are sourced from the U.S. Census Bureau 2020 Census (land area only, water excluded). Values range from ~1.9 people/sq mi (Inyo County) to ~18,000 people/sq mi (San Francisco).

### 4.8 Zip-to-County Mapping (DMV Vehicles)

The DMV vehicle dataset is organized by zip code. Since zip codes can span multiple counties, the ETL downloads the Census Bureau's 2020 ZCTA-to-County relationship file and assigns each zip code to the county containing the largest share of its land area. This covers approximately 95% of California zip codes; out-of-state and PO Box zip codes are excluded.

---

## 5. Derived Metrics and Formulas

### 5.1 Rate Normalization (Materialized View: `mv_crash_rates`)

All rates are computed per county per year per severity level:

| Metric | Formula | Purpose |
|---|---|---|
| **Crashes per 100K population** | `(total_crashes / population) * 100,000` | Standard population-adjusted rate |
| **Crashes per 10K licensed drivers** | `(total_crashes / licensed_drivers) * 10,000` | Exposure-adjusted rate (NHTSA standard) |
| **Crashes per 100 road miles** | `(total_crashes / total_road_miles) * 100` | Infrastructure-adjusted rate |
| **Crashes per 100K AADT** | `(total_crashes / total_aadt) * 100,000` | Traffic volume-adjusted rate |
| **Crashes per 10K registered vehicles** | `(total_crashes / total_vehicles) * 10,000` | Vehicle fleet-adjusted rate |

### 5.2 Fatality Rate

Computed client-side in the correlation matrix:

```
fatality_rate = (total_killed / total_crashes) * 100
```

Expressed as a percentage. Zero crashes yields a fatality rate of 0.

### 5.3 Year-over-Year (YoY) Change

Computed in the county insights generation:

```
yoy_change_pct = ((current_year_crashes - prior_year_crashes) / prior_year_crashes) * 100
```

NULL when prior year data is unavailable.

### 5.4 EV Percentage

Computed client-side:

```
ev_pct = (ev_vehicles / total_vehicles) * 100
```

Where `ev_vehicles` = Battery Electric + Plug-in Hybrid registrations.

### 5.5 Vehicles per Capita

Computed client-side:

```
vehicles_per_capita = total_vehicles / population
```

---

## 6. Statistical Methods

CalSight implements a pure-TypeScript statistical hypothesis testing library (`frontend/src/lib/dashboard/hypothesis.ts`) with no external dependencies. All p-values are computed via analytical approximations using the incomplete gamma function, incomplete beta function, and normal CDF -- no lookup tables.

### 6.1 Pearson Correlation Coefficient

Used in the 26-variable correlation matrix. Computed across all 58 California counties (one observation per county).

```
r = SUM((x_i - x_mean)(y_i - y_mean)) / sqrt(SUM((x_i - x_mean)^2) * SUM((y_i - y_mean)^2))
```

Requires a minimum of 5 valid (non-NaN, finite) paired observations per cell. Pairs with fewer than 5 observations report r = 0.

**Significance testing:** Converts r to a t-statistic: `t = r * sqrt(n-2) / sqrt(1 - r^2)`, where n = number of counties. P-value computed from the t-distribution CDF with n-2 degrees of freedom. Confidence intervals use Fisher's z-transformation: `z = arctanh(r)`, `SE(z) = 1/sqrt(n-3)`.

### 6.2 Correlation Matrix Variables (26 total)

The correlation matrix computes all 325 unique pairwise Pearson correlations among:

| Variable | Source |
|---|---|
| Crashes, Fatalities, Injuries, Fatality Rate | Crash statistics (filtered) |
| Poverty %, Income, Population Density | Census ACS demographics |
| Age 18-24 %, Age 65+ % | Census ACS demographics |
| No Vehicle %, Drive Alone %, Bike % | Census ACS demographics |
| Disability % | Census ACS demographics |
| Unemployment Rate | BLS LAUS |
| CES Score, CES Percentile | CalEnviroScreen 5.0 |
| Traffic Score, Pollution Burden, Diesel PM | CalEnviroScreen 5.0 |
| Linguistic Isolation %, Housing Burden %, No Diploma % | CalEnviroScreen 5.0 |
| EV %, Vehicles per Capita | DMV vehicle registrations |
| Average Temperature, Total Rainfall | NOAA weather |

### 6.3 Multiple Testing Correction

When testing significance across the full 325-cell correlation matrix, CalSight applies **Benjamini-Hochberg False Discovery Rate (FDR) correction**:

1. Sort all 325 p-values in ascending order.
2. For rank k, compute adjusted p-value: `p_adj(k) = min(1, p(k) * m / k)` where m = 325.
3. Enforce monotonicity from the bottom up.
4. Mark cells as significant where FDR-adjusted p < 0.05.

**Bonferroni correction** is also available for more conservative analysis: `p_corrected = min(1, p_raw * m)`.

### 6.4 Chi-Squared Test of Independence

Tests whether categorical distributions differ between groups.

```
X^2 = SUM_ij [(O_ij - E_ij)^2 / E_ij]
```

Where `E_ij = (row_i_total * col_j_total) / grand_total`. Degrees of freedom: `(rows - 1) * (cols - 1)`.

**Effect size:** Cramer's V = `sqrt(X^2 / (n * min(rows-1, cols-1)))`. Interpretation: V < 0.1 negligible, 0.1-0.3 small, 0.3-0.5 medium, > 0.5 large.

**Use case:** Testing whether severity distributions differ significantly between counties.

### 6.5 Welch's Two-Sample t-Test

Tests whether two group means differ, without assuming equal variances.

```
t = (x_bar_1 - x_bar_2) / sqrt(s_1^2/n_1 + s_2^2/n_2)
```

Degrees of freedom via Welch-Satterthwaite approximation. Effect size: Cohen's d with pooled standard deviation. 95% confidence interval for the mean difference.

**Use case:** Comparing weekday vs. weekend crash counts.

### 6.6 One-Way ANOVA

Tests whether means differ across k groups.

```
F = MS_between / MS_within
```

Where `MS_between = SS_between / (k-1)` and `MS_within = SS_within / (N-k)`.

**Effect size:** eta-squared = `SS_between / SS_total`. Interpretation: < 0.01 negligible, 0.01-0.06 small, 0.06-0.14 medium, > 0.14 large.

Includes a homogeneity-of-variance check (max/min group variance ratio; warns if > 4:1).

**Use case:** Testing whether crash rates differ across age groups.

### 6.7 Mann-Kendall Trend Test

Non-parametric test for monotonic trends in time series. Does not assume linearity or normality.

1. For all pairs (i, j) where j > i, compute `sgn(x_j - x_i)`.
2. `S = SUM(sgn values)`. Positive S suggests increasing trend; negative suggests decreasing.
3. Variance with tied-group correction: `Var(S) = [n(n-1)(2n+5) - SUM_t t(t-1)(2t+5)] / 18`.
4. Z-statistic with continuity correction; p-value from normal approximation (valid for n > 10).

**Effect size:** Kendall's tau = `S / [n(n-1)/2]`. Range: -1 to +1.

**Sen's Slope:** Median of all pairwise slopes `(x_j - x_i) / (j - i)`. Robust to outliers, unlike OLS regression.

**Use case:** Testing whether fatality counts show a significant trend over years.

### 6.8 Kolmogorov-Smirnov Two-Sample Test

Tests whether two samples come from the same continuous distribution. Sensitive to differences in shape, spread, and location (not just mean).

```
D = max |F_1(x) - F_2(x)|
```

P-value from the Kolmogorov asymptotic distribution using the effective sample size `n_e = (n_1 * n_2) / (n_1 + n_2)`.

**Use case:** Comparing crash severity distributions between two counties.

### 6.9 Mathematical Engine

All distribution CDFs are computed analytically:
- **Gamma function:** Lanczos approximation (accurate to ~15 digits)
- **Incomplete gamma (chi-squared CDF):** Series expansion for `x < a+1`, continued fraction (Lentz's method) otherwise
- **Incomplete beta (t and F CDFs):** Continued fraction with symmetry transform
- **Normal CDF:** Abramowitz and Stegun approximation 7.1.26 (max error 1.5e-7)
- **Inverse normal:** Beasley-Springer-Moro rational approximation

---

## 7. Data Quality and Limitations

### 7.1 Geocoding Completeness

Not all crash records have latitude/longitude coordinates. The `data_quality_stats` table tracks fill rates per county per year. Coordinate completeness varies significantly:
- Recent CCRS years (2020+): typically >90% geocoded
- Older SWITRS years (2001-2010): geocoding rates may be lower
- The ETL validates coordinates against county boundaries and flags mismatches

### 7.2 SWITRS-CCRS Transition

The system transition in 2016 introduces methodological discontinuities:
- **Party/victim data** is only available for CCRS (2016+). Involvement flags (alcohol, drugs, distraction, cyclist, pedestrian) are NULL for SWITRS crashes.
- **Field naming and coding** changed between systems. The ETL harmonizes both into a common schema, but subtle differences in categorization may exist.
- **Time series analysis** spanning the transition should note this boundary.

### 7.3 Census ACS Coverage Gaps

- **Pre-2010 data** uses ACS 1-year estimates, which only cover counties with population > 65,000. Smaller rural counties have no demographic data for 2005-2009.
- **Education fields** (B15003) are NULL before 2012 in the ACS 5-year data.
- **Disability data** (B18101) has inconsistent availability before 2010.

### 7.4 Aggregate-Only Analysis

All analysis is performed at the county level or higher. CalSight does not:
- Identify individual persons involved in crashes
- Track specific vehicles or license plates
- Link crash records to individual health outcomes
- Perform neighborhood-level (census tract) analysis (CalEnviroScreen tracts are aggregated to county level)

### 7.5 Reporting Bias

- **Minor crashes** may be underreported. California Vehicle Code 20008 only requires police reporting for crashes involving injury, death, or certain hit-and-run events. Property-damage-only crashes below the reporting threshold are not captured.
- **Hit-and-run** crashes may have incomplete information about involved parties.
- **Self-reported fields** (age, sobriety status) may contain inaccuracies.

### 7.6 Temporal Lag

- CCRS data is updated daily on data.ca.gov but may lag actual crash dates by days to weeks depending on CHP processing.
- Census ACS data is published annually, approximately 12 months after the reference year.
- NOAA weather data has a lag of approximately 1-2 months.
- BLS unemployment data is released with a 1-2 month lag.

### 7.7 Speed Limit Data Vintage

The HPMS speed limit data is from 2022. Speed limits change over time due to road improvements, zone changes, and policy updates. The 2022 snapshot may not reflect current conditions.

### 7.8 Ecological Fallacy

County-level correlations (e.g., poverty rate vs. crash rate) describe associations between county averages, not individual-level relationships. A high correlation between county poverty and county crash rates does not mean that poor individuals are more likely to crash -- this is the ecological fallacy. CalSight's analysis is appropriate for policy-level and infrastructure-level insights, not individual risk assessment.

---

## 8. Update Schedule

| Schedule | Data Sources | Trigger |
|---|---|---|
| **Daily** (3 AM Pacific) | CCRS crashes, parties, victims; derived fields; materialized views; coordinate validation; data quality; AI insights | Automated cron via APScheduler |
| **Monthly** | Demographics, weather, unemployment, hospitals, schools, speed limits, AADT, vehicles, CalEnviroScreen, licensed drivers, road miles | Automated cron (monthly check) |
| **Static** | SWITRS (2001-2015 historical archive) | Manual trigger only (data is fixed) |

The orchestrator supports freshness checking: before re-fetching a source, it queries the CKAN/ArcGIS metadata to determine if the upstream data has changed since the last successful load. If unchanged, the job is skipped (`skipped_unchanged` status).

---

## 9. Privacy and Ethics

### 9.1 No Personally Identifiable Information (PII)

All data sources used by CalSight are published as aggregate or anonymized records by their respective government agencies:

- **Crash records** do not contain names, addresses, license plates, driver's license numbers, or insurance information. Records are identified by CHP-assigned collision IDs.
- **Party/victim records** contain only age (stated, not verified), gender code (M/F/U), and crash-related attributes (sobriety, safety equipment). No names or identifying information.
- **Demographics** are county-level Census aggregates -- no individual-level records.
- **All other sources** (weather, unemployment, vehicles, hospitals, schools) are inherently aggregate or institutional data.

### 9.2 Legal Basis for Data Access

All data sources are accessed through legally authorized public channels:

| Legal Framework | Applicable Sources |
|---|---|
| **California Public Records Act** (Gov. Code 6250-6270) | CCRS, SWITRS, DMV vehicles, DMV drivers, hospitals, schools, road miles, Caltrans AADT |
| **Freedom of Information Act** (5 U.S.C. 552) | Census ACS, NOAA weather, BLS unemployment, FHWA HPMS |
| **SB 535 / AB 1550** (Environmental Justice) | CalEnviroScreen |
| **Open Data Portals** | data.ca.gov (CKAN), Census API, NOAA CDO API, BLS API |

### 9.3 CCPA and COPPA Compliance

CalSight does not collect personal information as defined by the California Consumer Privacy Act (CCPA). The platform requires no user accounts, collects no browsing data, and stores no cookies or tracking identifiers. See the full [Privacy Policy](../frontend/src/pages/PrivacyPage.tsx) for details including third-party service disclosures.

### 9.4 Responsible Use

CalSight is designed for policy analysis, infrastructure planning, and public safety research. The aggregate nature of the data makes it unsuitable for -- and intentionally prevents -- individual surveillance, profiling, or discrimination.

---

## 10. Reproducibility

### 10.1 Open Source

CalSight's complete source code -- ETL pipeline, API server, and frontend -- is publicly available on GitHub. All data transformations are implemented in Python and TypeScript with no proprietary dependencies.

### 10.2 Deterministic Pipeline

The ETL pipeline is fully deterministic given the same source data. All transformation rules (regex patterns, aggregation logic, classification thresholds) are defined in code, not configured at runtime. The only non-deterministic component is AI-generated narrative text (county insight cards), which is stored alongside the deterministic statistics it describes.

### 10.3 API Keys Required

Reproducing the full pipeline requires free API keys from:
- U.S. Census Bureau: https://api.census.gov/data/key_signup.html
- NOAA CDO: https://www.ncdc.noaa.gov/cdo-web/token
- Bureau of Labor Statistics: https://www.bls.gov/developers/

All other data sources (data.ca.gov CKAN, Caltrans ArcGIS, FHWA ArcGIS, OEHHA ArcGIS, Zenodo) are accessible without authentication.

---

## 11. References

### Data Source Documentation

1. California Highway Patrol. *California Crash Reporting System (CCRS)*. California Open Data Portal. https://data.ca.gov/dataset/california-crash-reporting-system

2. California Highway Patrol. *Statewide Integrated Traffic Records System (SWITRS)*. Zenodo. https://zenodo.org/records/4284843

3. U.S. Census Bureau. *American Community Survey (ACS) 5-Year Estimates*. https://www.census.gov/programs-surveys/acs

4. NOAA National Centers for Environmental Information. *Climate Data Online: Global Summary of the Month*. https://www.ncei.noaa.gov/cdo-web/

5. U.S. Bureau of Labor Statistics. *Local Area Unemployment Statistics*. https://www.bls.gov/lau/

6. California Department of Motor Vehicles. *Vehicle Fuel Type Count by Zip Code*. https://data.ca.gov/dataset/vehicle-fuel-type-count-by-zip-code

7. California Department of Motor Vehicles. *Driver Licenses Outstanding by County*. https://data.ca.gov/dataset/driver-licenses-outstanding-by-county

8. California Department of Transportation. *Traffic Census Program AADT*. https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/Traffic_AADT/FeatureServer

9. California Department of Transportation. *Public Road Functional Classification*. https://data.ca.gov/dataset/public-road-functional-classification

10. Federal Highway Administration. *Highway Performance Monitoring System (HPMS)*. https://geo.dot.gov/server/rest/services/Hosted/HPMS_Full_CA_2022/FeatureServer

11. California Health Care Access and Information. *Licensed and Certified Healthcare Facility Listing*. https://data.ca.gov/dataset/licensed-and-certified-healthcare-facility-listing

12. California Department of Education. *California Public Schools*. https://data.ca.gov/dataset/california-public-schools

13. California Office of Environmental Health Hazard Assessment. *CalEnviroScreen 5.0*. https://oehha.ca.gov/calenviroscreen

### Statistical Methods

14. Conover, W.J. (1999). *Practical Nonparametric Statistics*, 3rd ed. Wiley.

15. Numerical Recipes in C, Chapter 6: Special Functions. Cambridge University Press.

16. NIST/SEMATECH Engineering Statistics Handbook. https://www.itl.nist.gov/div898/handbook/

17. Benjamini, Y. and Hochberg, Y. (1995). "Controlling the false discovery rate: a practical and powerful approach to multiple testing." *Journal of the Royal Statistical Society, Series B*, 57(1), 289-300.

### Legal Authorities

18. California Public Records Act, Government Code Sections 6250-6270.

19. Freedom of Information Act, 5 U.S.C. 552.

20. Title 13, United States Code (Census Bureau enabling legislation).

21. California Vehicle Code Section 20008 (mandatory crash reporting).

22. SB 535 (De Leon, 2012) and AB 1550 (Gomez, 2016) -- Disadvantaged Communities designation.

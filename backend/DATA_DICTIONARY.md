# CalSight Data Dictionary

Last updated: 2026-04-17

Column-by-column reference for every table in the CalSight database.

- **DATA_VALIDATION.md** — what row counts / data ranges are actually loaded
- **DATA_GAPS.md** — what's missing or incomplete, and why
- **This doc** — what every column means, type, nullability, and where it came from

## Conventions

- **PK** = primary key  
- **FK** = foreign key (target shown in the notes column)  
- **Null** = `Y` nullable / `N` required  
- All datetimes are UTC  
- All percentages are 0.0–100.0 floats (not 0.0–1.0 fractions)  
- Strings have a max length shown in parens: `String(50)` = 50 chars max

---

## 1. `counties`

**Purpose:** Lookup table for California's 58 counties. Every other geographic table FKs into this.  
**Grain:** One row per county (58 total, hardcoded).  
**Source:** Seeded from `app/seed_counties.py` using US Census Bureau county list; land areas from 2020 Census.

| Column | Type | Null | Description |
|---|---|---|---|
| `code` | SmallInteger | N | **PK.** Our internal 1–58 code (alphabetical: 1=Alameda, 58=Yuba) |
| `name` | String(50) | N | County name (e.g., "Los Angeles"). Unique |
| `fips` | String(5) | Y | Full 5-digit FIPS code (e.g., "06037" for LA). Used for Census/NOAA joins |
| `latitude` | Float | Y | Geographic centroid latitude |
| `longitude` | Float | Y | Geographic centroid longitude |
| `population` | Integer | Y | Total population (Census 2020 reference value) |
| `land_area_sq_miles` | Float | Y | Land area only (excludes water). Used to compute `demographics.population_density` |
| `geojson` | Text | Y | County boundary GeoJSON for choropleth map rendering |

---

## 2. `crashes`

**Purpose:** Every reported traffic crash in California from 2001 to present.  
**Grain:** One row per crash (aka collision).  
**Source:** SWITRS archive via Zenodo (2001–2015) + CCRS CKAN API on data.ca.gov (2016–present).  
**Loaded by:** `etl.load_crashes`

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | BigInteger | N | **PK.** Auto-increment |
| `collision_id` | BigInteger | N | Upstream identifier. Unique within a given `data_source` |
| `crash_datetime` | DateTime | N | When the crash happened. Indexed |
| `day_of_week` | String(10) | Y | e.g., "Monday". CCRS-only (SWITRS doesn't report it) |
| `county_code` | SmallInteger | N | **FK → counties.code.** Indexed |
| `city_name` | String(100) | Y | City name. CCRS-only (SWITRS uses numeric codes we don't dereference) |
| `latitude` | Float | Y | Only populated for ~37% of crashes — see DATA_GAPS.md |
| `longitude` | Float | Y | Only populated for ~37% of crashes — see DATA_GAPS.md |
| `collision_type` | String(100) | Y | e.g., "Rear End", "Head-On", "Sideswipe" |
| `primary_factor` | String(100) | Y | CHP's root cause. 12,517 distinct values — mix of English ("speeding") and CA Vehicle Code numbers ("22350"). Indexed. See `canonical_cause` for filtering |
| `motor_vehicle_involved_with` | String(100) | Y | What the vehicle hit (another vehicle, pedestrian, fixed object, etc.) |
| `number_killed` | SmallInteger | Y | Fatalities at the scene (default 0) |
| `number_injured` | SmallInteger | Y | Injured persons (default 0) |
| `weather` | String(100) | Y | Weather at time of crash: "Clear", "Raining", "Fog", "Snowing", etc. |
| `road_condition` | String(100) | Y | "Dry", "Wet", "Snowy/Icy", etc. |
| `lighting` | String(100) | Y | "Daylight", "Dusk/Dawn", "Dark - Street Lights On", etc. |
| `is_highway` | Boolean | Y | Crash occurred on a state highway |
| `is_freeway` | Boolean | Y | Crash occurred on a controlled-access freeway. CCRS-only |
| `primary_road` | String(100) | Y | Primary street/highway name |
| `secondary_road` | String(100) | Y | Cross street (for intersection crashes) |
| `hit_run` | String(1) | Y | `NULL` = not a hit-and-run, `"M"` = misdemeanor, `"F"` = felony |
| `crash_hour` | SmallInteger | Y | 0–23. Pre-extracted from `crash_datetime` so time-of-day charts don't need `EXTRACT()` on 11M rows. Backfilled by `etl.backfill_derived` |
| `severity` | String(25) | Y | Pre-computed from killed/injured: `"Fatal"` / `"Injury"` / `"Property Damage Only"`. Backfilled by `etl.backfill_derived` |
| `pedestrian_involved` | Boolean | Y | At least one party was a pedestrian |
| `is_alcohol_involved` | Boolean | Y | At least one party had sobriety = HBD or drugs. **CCRS-only** (SWITRS has no party data — stays NULL for pre-2016) |
| `is_distraction_involved` | Boolean | Y | At least one party had cell phone use recorded. **CCRS-only** |
| `data_source` | String(10) | Y | `"switrs"` or `"ccrs"`. Part of the upsert key |
| `canonical_cause` | String(20) | Y | Small-vocabulary cause category derived from `primary_factor`: `"speeding"`, `"dui"`, `"lane_change"`, `"other"`, or NULL (no `primary_factor`). Indexed for API filters. Backfilled by `etl.backfill_derived`. `"distracted"` and `"weather"` categories come from `is_distraction_involved` and `weather` columns, not from this one |
| `created_at` | DateTime | Y | Row insertion timestamp |

**Indexes:**
- `ix_crashes_county_code`, `ix_crashes_crash_datetime`, `ix_crashes_primary_factor`
- `ix_crashes_county_datetime` (county_code, crash_datetime)
- `ix_crashes_severity`, `ix_crashes_crash_hour`, `ix_crashes_alcohol`, `ix_crashes_distraction`
- `ix_crashes_coords_partial` (county_code, crash_datetime) WHERE latitude IS NOT NULL
- `ix_crashes_county_severity_datetime` (county_code, severity, crash_datetime)
- `ix_crashes_datetime_brin` BRIN index for large range scans
- `ix_crashes_canonical_cause`

**Uniqueness:** (collision_id, data_source) — same collision_id can exist in both SWITRS and CCRS.

---

## 3. `crash_parties`

**Purpose:** One row per person/vehicle involved in a CCRS crash (drivers, pedestrians, cyclists).  
**Grain:** One row per party per crash. Links to `crashes.collision_id`.  
**Source:** CCRS `Parties` resources on data.ca.gov (one resource per year).  
**Loaded by:** `etl.load_parties_victims`  
**Coverage:** CCRS only (2016+). SWITRS has no party data.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | BigInteger | N | **PK** |
| `party_id` | BigInteger | N | Upstream party identifier. Unique within a data_source |
| `collision_id` | BigInteger | N | Links back to `crashes.collision_id` (same data_source). Indexed |
| `party_number` | SmallInteger | Y | 1, 2, 3… within a crash |
| `party_type` | String(30) | Y | "Driver", "Pedestrian", "Bicyclist", "Parked", etc. |
| `at_fault` | Boolean | Y | Whether this party was the at-fault party. Indexed |
| `gender` | String(1) | Y | "M", "F", or "U". Indexed |
| `age` | SmallInteger | Y | Stated age at time of crash. Frequently null |
| `sobriety` | String(100) | Y | "HBD-UNDER INFLUENCE", "Under Drug Influence", "Had Not Been Drinking", etc. NULL ≠ sober, it means not recorded |
| `vehicle_type` | String(100) | Y | Passenger car, Truck, Motorcycle, etc. |
| `vehicle_year` | SmallInteger | Y | Model year of vehicle |
| `vehicle_make` | String(50) | Y | Toyota, Ford, Honda, etc. |
| `speed_limit` | SmallInteger | Y | Posted speed limit where this party was traveling (mph) |
| `movement` | String(100) | Y | "Proceeding Straight", "Making Left Turn", "Stopped", etc. |
| `safety_equipment` | String(100) | Y | Seatbelt, helmet, none, etc. |
| `cell_phone_use` | String(50) | Y | "CELL PHONE HANDHELD IN USE", etc. Extracted from unstructured text — hit or miss |
| `data_source` | String(10) | Y | Always `"ccrs"` |
| `created_at` | DateTime | Y | Row insertion timestamp |

**Uniqueness:** (party_id, data_source).

---

## 4. `crash_victims`

**Purpose:** One row per injured person, witness, or passenger in a CCRS crash.  
**Grain:** One row per victim per crash.  
**Source:** CCRS `InjuredWitnessPassengers` resources on data.ca.gov.  
**Loaded by:** `etl.load_parties_victims`  
**Coverage:** CCRS only (2016+).

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | BigInteger | N | **PK** |
| `victim_id` | BigInteger | N | Upstream identifier |
| `collision_id` | BigInteger | N | Links to `crashes.collision_id`. Indexed |
| `party_number` | SmallInteger | Y | Which party in the crash this victim belongs to |
| `age` | SmallInteger | Y | Stated age |
| `gender` | String(1) | Y | "M", "F", or "U". Indexed |
| `injury_severity` | String(50) | Y | "Fatal", "Severe", "Visible", "Complaint of Pain", "Uninjured". Indexed |
| `person_type` | String(30) | Y | "Driver", "Passenger", "Pedestrian", etc. |
| `seat_position` | String(50) | Y | Where the victim was seated (passengers only) |
| `safety_equipment` | String(100) | Y | Seatbelt, airbag, helmet, none, etc. |
| `ejected` | String(30) | Y | "NotEjected", "FullyEjected", "PartiallyEjected" |
| `data_source` | String(10) | Y | Always `"ccrs"` |
| `created_at` | DateTime | Y | Row insertion timestamp |

**Uniqueness:** (victim_id, data_source).

---

## 5. `demographics`

**Purpose:** Census ACS data for each county for each year. Powers per-capita rates, equity analysis, demographic context.  
**Grain:** One row per county per year.  
**Source:** US Census Bureau ACS 5-year (2010+) and ACS 1-year (2005–2009). Pulled via official Census API.  
**Loaded by:** `etl.load_demographics`

See DATA_GAPS.md for coverage gaps: education fields are NULL before 2012, and small counties (<65K pop) are missing for 2005–2009.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | Integer | N | **PK** |
| `county_code` | SmallInteger | N | **FK → counties.code** |
| `year` | SmallInteger | N | Calendar year. Indexed |
| `population` | Integer | Y | Total population estimate |
| `median_age` | Float | Y | Median age in years |
| `median_income` | Integer | Y | Median household income in USD |
| `commute_drive_alone_pct` | Float | Y | % of workers who drive alone |
| `commute_carpool_pct` | Float | Y | % who carpool |
| `commute_transit_pct` | Float | Y | % who take public transit |
| `commute_walk_pct` | Float | Y | % who walk |
| `commute_bike_pct` | Float | Y | % who bike |
| `commute_wfh_pct` | Float | Y | % who work from home |
| `pct_white` | Float | Y | White alone, not Hispanic (from B03002) |
| `pct_black` | Float | Y | Black alone, not Hispanic |
| `pct_asian` | Float | Y | Asian alone, not Hispanic |
| `pct_hispanic` | Float | Y | Hispanic/Latino, any race |
| `pct_other_race` | Float | Y | Native American, Pacific Islander, multiracial, other |
| `pct_under_18` | Float | Y | Age bracket from B01001 |
| `pct_18_24` | Float | Y | Young adults — highest crash risk group |
| `pct_25_44` | Float | Y | Prime working age |
| `pct_45_64` | Float | Y | Middle age |
| `pct_65_plus` | Float | Y | Elderly — most vulnerable as pedestrians |
| `poverty_rate` | Float | Y | % below poverty line (from B17001) |
| `pct_bachelors_or_higher` | Float | Y | % of 25+ with bachelor's degree (from B15003). **NULL before 2012** |
| `pct_high_school_or_higher` | Float | Y | % of 25+ with HS diploma. **NULL before 2012** |
| `pct_no_vehicle` | Float | Y | % of households with zero vehicles (from B08201) |
| `pct_owner_occupied_housing` | Float | Y | % of housing that's owner-occupied (from B25003) |
| `pct_english_only` | Float | Y | % speaking only English at home (from B16001) |
| `pct_spanish_speaking` | Float | Y | % speaking Spanish at home |
| `population_density` | Float | Y | `population / counties.land_area_sq_miles`. Backfilled by `etl.backfill_derived` |
| `created_at` | DateTime | Y | Row insertion timestamp |

**Uniqueness:** (county_code, year).

---

## 6. `county_insights`

**Purpose:** Pre-computed summary stats and AI-generated narrative per county per year. Drives the MapPage insight card.  
**Grain:** One row per county per year.  
**Source:** Computed from `crashes` + `demographics`; narrative generated by AI.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | Integer | N | **PK** |
| `county_code` | SmallInteger | N | **FK → counties.code** |
| `year` | SmallInteger | N | Calendar year |
| `total_crashes` | Integer | Y | Total crashes for this county/year |
| `total_killed` | SmallInteger | Y | Sum of `number_killed` for this county/year |
| `total_injured` | Integer | Y | Sum of `number_injured` |
| `crash_rate_per_capita` | Float | Y | `total_crashes / demographics.population` (scaled) |
| `top_cause` | String(100) | Y | Most common `primary_factor` in this county/year |
| `top_cause_pct` | Float | Y | % of crashes caused by `top_cause` |
| `yoy_change_pct` | Float | Y | Year-over-year change in total_crashes |
| `peak_hour` | SmallInteger | Y | Hour of day (0–23) with the most crashes |
| `dui_pct` | Float | Y | % of crashes flagged `is_alcohol_involved` |
| `narrative` | Text | Y | AI-generated description for the insight card |
| `generated_at` | DateTime | Y | When the narrative was generated |
| `created_at` | DateTime | Y | Row insertion timestamp |

**Uniqueness:** (county_code, year).

---

## 7. `county_insight_details`

**Purpose:** Granular breakdowns per county/year by category. Powers charts on the insight card.  
**Grain:** One row per (county, year, category, label) combination.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | Integer | N | **PK** |
| `county_code` | SmallInteger | N | **FK → counties.code** |
| `year` | SmallInteger | N | Calendar year |
| `category` | String(30) | N | What kind of breakdown (e.g., "collision_type", "primary_factor", "hour_of_day") |
| `label` | String(100) | N | The value within that category (e.g., "Rear End", "22350", "14") |
| `count` | Integer | Y | How many crashes matched |
| `pct_of_total` | Float | Y | % of county/year total |
| `yoy_change_pct` | Float | Y | YoY change for this specific label |
| `created_at` | DateTime | Y | Row insertion timestamp |

**Uniqueness:** (county_code, year, category, label).

---

## 8. `weather`

**Purpose:** Monthly weather summary per county. Enables weather-vs-crash correlation.  
**Grain:** One row per (county, year, month).  
**Source:** NOAA GSOM (Global Summary of the Month) via Climate Data Online API.  
**Loaded by:** `etl.noaa_weather`  
**Caveat:** Rural counties have fewer weather stations → less reliable averages. See DATA_GAPS.md.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | Integer | N | **PK** |
| `county_code` | SmallInteger | N | **FK → counties.code** |
| `year` | SmallInteger | N | 2001–2025 |
| `month` | SmallInteger | N | 1–12 |
| `avg_temp_f` | Float | Y | Average temperature (°F), averaged across all stations in the county |
| `max_temp_f` | Float | Y | Average of daily max temps |
| `min_temp_f` | Float | Y | Average of daily min temps |
| `precipitation_in` | Float | Y | Total precipitation (inches), averaged across stations |
| `created_at` | DateTime | Y | Row insertion timestamp |

**Uniqueness:** (county_code, year, month).

---

## 9. `speed_limits`

**Purpose:** Posted speed limit distribution per county. Enables crash-severity-vs-speed analysis.  
**Grain:** One row per (county, speed_limit).  
**Source:** FHWA HPMS 2022 via geo.dot.gov ArcGIS FeatureServer.  
**Loaded by:** `etl.load_speed_limits`  
**Caveat:** HPMS only covers federal-aid highways — local streets aren't in here.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | Integer | N | **PK** |
| `county_code` | SmallInteger | N | **FK → counties.code** |
| `speed_limit` | SmallInteger | N | Posted speed in mph |
| `segment_count` | Integer | Y | How many road segments have this speed limit in this county |
| `avg_lanes` | Float | Y | Average number of through-lanes for segments at this speed |
| `total_aadt` | Integer | Y | Total Annual Average Daily Traffic across those segments |
| `created_at` | DateTime | Y | Row insertion timestamp |

**Uniqueness:** (county_code, speed_limit).

---

## 10. `hospitals`

**Purpose:** California hospital and trauma center locations. Enables crash-vs-trauma-distance analysis.  
**Grain:** One row per facility.  
**Source:** CA HCAI "Licensed and Certified Healthcare Facility Listing" on data.ca.gov.  
**Loaded by:** `etl.load_hospitals`  
**Filter:** Only General Acute Care, Acute Psychiatric, and Acute Children's hospitals (not nursing facilities or clinics).

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | Integer | N | **PK** |
| `facility_id` | String(20) | N | HCAI facility ID. Unique |
| `facility_name` | String(200) | N | Hospital name |
| `facility_type` | String(100) | Y | "GENERAL ACUTE CARE HOSPITAL", "ACUTE PSYCHIATRIC HOSPITAL", etc. |
| `county_code` | SmallInteger | N | **FK → counties.code.** Indexed |
| `city` | String(100) | Y | City |
| `address` | String(200) | Y | Street address |
| `latitude` | Float | Y | Location |
| `longitude` | Float | Y | Location |
| `bed_capacity` | Integer | Y | Licensed bed count |
| `trauma_center` | String(50) | Y | Trauma level ("Level I", "Level II", "Level III") or NULL |
| `trauma_pediatric` | String(50) | Y | Pediatric trauma level, separate designation |
| `status` | String(20) | Y | "OPEN" or "CLOSED" |
| `created_at` | DateTime | Y | Row insertion timestamp |

---

## 11. `vehicle_registrations`

**Purpose:** Registered vehicles per county per year. Denominator for crashes-per-vehicle rates.  
**Grain:** One row per (county, year).  
**Source:** CA DMV "Vehicle Fuel Type Count by Zip Code" on data.ca.gov.  
**Loaded by:** `etl.dmv_vehicles`  
**Caveat:** Zip-to-county mapping is ~95% accurate (uses Census crosswalk).

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | Integer | N | **PK** |
| `county_code` | SmallInteger | N | **FK → counties.code** |
| `year` | SmallInteger | N | 2019–2026 |
| `total_vehicles` | Integer | Y | Total registered vehicles summed from zip-level data |
| `ev_vehicles` | Integer | Y | Battery Electric + Plug-in Hybrid |
| `created_at` | DateTime | Y | Row insertion timestamp |

**Uniqueness:** (county_code, year).

---

## 12. `school_locations`

**Purpose:** K-12 public school locations. Enables "crashes near schools" analysis.  
**Grain:** One row per active school.  
**Source:** CA Dept of Education "California Public Schools 2024-25" on data.ca.gov.  
**Loaded by:** `etl.load_schools`  
**Filter:** Only schools with `status = "Active"`.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | Integer | N | **PK** |
| `cds_code` | String(14) | N | County-District-School code. Unique |
| `school_name` | String(200) | N | School name |
| `county_code` | SmallInteger | N | **FK → counties.code.** Indexed |
| `city` | String(100) | Y | City |
| `latitude` | Float | Y | Location |
| `longitude` | Float | Y | Location |
| `school_type` | String(50) | Y | "Elementary", "Middle", "High", "K-12", etc. |
| `status` | String(20) | Y | "Active" (only active schools are loaded) |
| `created_at` | DateTime | Y | Row insertion timestamp |

---

## 13. `traffic_volumes`

**Purpose:** Total AADT (Annual Average Daily Traffic) per county on state highways. Denominator for crashes-per-traffic-volume.  
**Grain:** One row per county.  
**Source:** Caltrans Traffic Census Program via ArcGIS FeatureServer.  
**Loaded by:** `etl.caltrans_aadt`  
**Caveat:** State highways only — local/county/city roads aren't counted.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | Integer | N | **PK** |
| `county_code` | SmallInteger | N | **FK → counties.code.** Unique |
| `total_aadt` | Integer | Y | Sum of AHEAD_AADT across all measured segments in the county |
| `segment_count` | SmallInteger | Y | How many road segments measured |
| `avg_aadt_per_segment` | Integer | Y | `total_aadt / segment_count` |
| `created_at` | DateTime | Y | Row insertion timestamp |

---

## 14. `unemployment_rates`

**Purpose:** Monthly unemployment rate for each county. Enables economic-vs-crash correlation.  
**Grain:** One row per (county, year, month).  
**Source:** Bureau of Labor Statistics LAUS (Local Area Unemployment Statistics) via public API.  
**Loaded by:** `etl.bls_unemployment`  
**Caveat:** ~2 months behind (BLS publish lag).

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | Integer | N | **PK** |
| `county_code` | SmallInteger | N | **FK → counties.code** |
| `year` | SmallInteger | N | 2005–2025 |
| `month` | SmallInteger | N | 1–12 |
| `unemployment_rate` | Float | Y | Percentage (e.g., 4.5 = 4.5%). Not seasonally adjusted |
| `created_at` | DateTime | Y | Row insertion timestamp |

**Uniqueness:** (county_code, year, month).

---

## 15. `calenviroscreen`

**Purpose:** CalEnviroScreen 4.0 environmental justice scores per county. Enables equity analysis.  
**Grain:** One row per county (all 58).  
**Source:** CA OEHHA (Office of Environmental Health Hazard Assessment) via ArcGIS, aggregated from ~8,000 census tracts using population-weighted averaging.  
**Loaded by:** `etl.load_calenviroscreen`  
**Caveat:** Single snapshot based on 2021 data. Not a time series.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | Integer | N | **PK** |
| `county_code` | SmallInteger | N | **FK → counties.code.** Unique |
| `ces_score` | Float | Y | Overall CES 4.0 score (pollution burden × population characteristics) |
| `ces_percentile` | Float | Y | Overall percentile (0–100). Higher = more burdened |
| `pollution_burden` | Float | Y | Pollution burden sub-score |
| `pop_characteristics` | Float | Y | Population characteristics sub-score |
| `pm25_score` | Float | Y | PM2.5 particulate matter exposure |
| `ozone_score` | Float | Y | Ground-level ozone |
| `diesel_pm_score` | Float | Y | Diesel particulate matter |
| `pesticide_score` | Float | Y | Pesticide use |
| `traffic_score` | Float | Y | Traffic proximity and volume |
| `poverty_pct` | Float | Y | % in poverty (population characteristics indicator) |
| `unemployment_pct` | Float | Y | % unemployed |
| `education_pct` | Float | Y | % 25+ without HS diploma |
| `linguistic_isolation_pct` | Float | Y | % in linguistically isolated households |
| `housing_burden_pct` | Float | Y | % housing-burdened |
| `tract_count` | SmallInteger | Y | How many tracts were aggregated for this county |
| `total_population` | Integer | Y | Population used for the weighted average |
| `created_at` | DateTime | Y | Row insertion timestamp |

---

## 16. `data_quality_stats`

**Purpose:** Pre-computed fill rates so the frontend can show coverage badges without counting 11M rows per page load.  
**Grain:** Three grain levels, stored in one table:
- Per (county, year) — most specific
- Per year only — `county_code IS NULL`
- Per county only — `year IS NULL`
**Source:** Computed from `crashes`, `crash_parties`, `crash_victims`.  
**Loaded by:** `etl.compute_data_quality`

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | Integer | N | **PK** |
| `county_code` | SmallInteger | Y | **FK → counties.code.** NULL for year-only rows |
| `year` | SmallInteger | Y | NULL for county-only rows |
| `total_crashes` | Integer | Y | Total crashes in this grouping |
| `crashes_with_coords` | Integer | Y | Subset with non-null lat/long |
| `coords_pct` | Float | Y | `crashes_with_coords / total_crashes` × 100 |
| `crashes_with_primary_factor` | Integer | Y | Subset with known cause |
| `primary_factor_pct` | Float | Y |  |
| `crashes_with_weather` | Integer | Y | Subset with weather recorded |
| `weather_pct` | Float | Y |  |
| `crashes_with_road_cond` | Integer | Y | Subset with road condition recorded |
| `road_cond_pct` | Float | Y |  |
| `crashes_with_lighting` | Integer | Y | Subset with lighting condition recorded |
| `lighting_pct` | Float | Y |  |
| `crashes_with_alcohol_flag` | Integer | Y | Subset with `is_alcohol_involved` set (TRUE or FALSE). CCRS only |
| `alcohol_flag_pct` | Float | Y |  |
| `crashes_alcohol_true` | Integer | Y | Subset with `is_alcohol_involved = TRUE` |
| `alcohol_true_pct` | Float | Y |  |
| `crashes_with_distraction_flag` | Integer | Y | Subset with `is_distraction_involved` set |
| `distraction_flag_pct` | Float | Y |  |
| `crashes_distraction_true` | Integer | Y | Subset with `is_distraction_involved = TRUE` |
| `distraction_true_pct` | Float | Y |  |
| `total_parties` | Integer | Y | Total parties in this grouping (CCRS only) |
| `parties_with_age` | Integer | Y |  |
| `age_pct` | Float | Y |  |
| `parties_with_gender` | Integer | Y |  |
| `gender_pct` | Float | Y |  |
| `parties_with_sobriety` | Integer | Y |  |
| `sobriety_pct` | Float | Y |  |
| `total_victims` | Integer | Y | Total victims in this grouping |
| `victims_with_injury_severity` | Integer | Y |  |
| `injury_severity_pct` | Float | Y |  |
| `created_at` | DateTime | Y | Row insertion timestamp |

**Uniqueness:** (county_code, year) — with NULLs allowed, as documented above.

---

## 17. `licensed_drivers`

**Purpose:** Licensed drivers per county per year. Denominator for crashes-per-10K-drivers (industry-standard rate).  
**Grain:** One row per (county, year).  
**Source:** CA DMV "Driver Licenses Outstanding by County" on data.ca.gov.  
**Loaded by:** `etl.load_licensed_drivers`

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | Integer | N | **PK** |
| `county_code` | SmallInteger | N | **FK → counties.code** |
| `year` | SmallInteger | N | 2008–2024 |
| `driver_count` | Integer | Y | Licensed drivers in the county at year-end |
| `created_at` | DateTime | Y | Row insertion timestamp |

**Uniqueness:** (county_code, year).

---

## 18. `road_miles`

**Purpose:** Road mileage per county broken out by road type. Denominator for crashes-per-100-miles-of-road.  
**Grain:** One row per (county, functional classification).  
**Source:** Caltrans road dataset on data.ca.gov, aggregated from ~780K segments via CKAN server-side GROUP BY.  
**Loaded by:** `etl.load_road_miles`  
**Caveat:** Mileage is in Web Mercator projection — 2–5% distortion at CA latitudes. Good for county comparison, not precise survey use.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | Integer | N | **PK** |
| `county_code` | SmallInteger | N | **FK → counties.code.** Indexed |
| `f_system` | SmallInteger | N | FHWA functional class: 1=Interstate, 2=Freeway/Expressway, 3=Principal Arterial, 4=Minor Arterial, 5=Major Collector, 6=Minor Collector, 7=Local |
| `segment_count` | Integer | Y | Number of distinct road segments |
| `total_miles` | Float | Y | Sum of segment lengths in miles |
| `created_at` | DateTime | Y | Row insertion timestamp |

**Uniqueness:** (county_code, f_system).

---

## 19–21. Materialized views for StatsPage

These are pre-aggregated SELECT results stored physically, refreshed by `etl.refresh_materialized_views` after every ETL run. Each has a UNIQUE index on its grouping columns so that `REFRESH MATERIALIZED VIEW CONCURRENTLY` can keep API reads unblocked during refresh.

### 19. `mv_crashes_by_hour`

**Purpose:** Hourly crash counts per county/year/severity/cause. Powers the time-of-day chart.  
**Rows:** ~306K.

| Column | Type | Null | Description |
|---|---|---|---|
| `county_code` | SmallInteger | N | **FK → counties.code** |
| `crash_year` | SmallInteger | N |  |
| `severity` | String | N | `"Fatal"`, `"Injury"`, `"Property Damage Only"`, or `"Unknown"` |
| `canonical_cause` | String | N | `"speeding"`, `"dui"`, `"lane_change"`, `"other"`, or `"uncategorized"` (for NULL primary_factor) |
| `crash_hour` | SmallInteger | N | 0–23 |
| `crash_count` | Integer | N | How many crashes in this group |

### 20. `mv_crashes_by_cause`

**Purpose:** Crash counts + casualty totals per county/year/severity/cause. Powers the "top causes" chart.  
**Rows:** ~20K.

| Column | Type | Null | Description |
|---|---|---|---|
| `county_code` | SmallInteger | N | **FK → counties.code** |
| `crash_year` | SmallInteger | N |  |
| `severity` | String | N |  |
| `canonical_cause` | String | N |  |
| `crash_count` | Integer | N |  |
| `total_killed` | Integer | N | Sum of `number_killed` in this group |
| `total_injured` | Integer | N | Sum of `number_injured` in this group |

### 21. `mv_crashes_by_year`

**Purpose:** Yearly trend data per county/severity. Powers the yearly trend chart.  
**Rows:** ~4.4K.

| Column | Type | Null | Description |
|---|---|---|---|
| `county_code` | SmallInteger | N | **FK → counties.code** |
| `crash_year` | SmallInteger | N |  |
| `severity` | String | N |  |
| `crash_count` | Integer | N |  |
| `total_killed` | Integer | N |  |
| `total_injured` | Integer | N |  |

---

### 22. `etl_runs`

**Purpose:** Audit log of every ETL pipeline execution. One row per loader per run.  
**Grain:** One row per (source, started_at).  
**Source:** Written by the `@track_etl_run(source)` decorator (see `etl/_utils.py`) on every loader.

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | Integer | N | **PK** |
| `source` | String(20) | N | Which pipeline ran ("crashes", "demographics", "weather", etc.) |
| `status` | String(20) | N | "running", "success", or "error" |
| `started_at` | DateTime | N | When the run began (UTC) |
| `finished_at` | DateTime | Y | When the run ended. NULL if still running |
| `rows_loaded` | Integer | Y | Count of rows the pipeline inserted/updated |
| `error_message` | Text | Y | Exception message if `status = 'error'` |
| `created_at` | DateTime | Y | Row insertion timestamp |

**Indexes:** `ix_etl_runs_source_started_at` (source, started_at) — fast lookup of "latest successful run of source X".

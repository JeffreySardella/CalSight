/**
 * Typed shapes for rows returned by the CalSight API.
 *
 * These interfaces replace the untyped `Record<string, unknown>` + `as number`
 * pattern the hooks previously used. Every field is optional and nullable
 * because the backend serializes SQL rows where any column can be NULL and
 * older cached responses may omit newer columns entirely — consumers must
 * handle null/undefined explicitly (usually with `??` fallbacks) instead of
 * asserting.
 */

/** Aggregate measures shared by every /api/stats/batch dimension row. */
export interface StatsMeasures {
  crash_count?: number | null;
  total_killed?: number | null;
  total_injured?: number | null;
  /** Victim-level counts (gender / age_bracket dimensions). */
  victim_count?: number | null;
  fatal_victim_count?: number | null;
  /** Party-level counts (at_fault_* dimensions). */
  party_count?: number | null;
  fatal_party_count?: number | null;
}

/**
 * A single row from POST /api/stats/batch. Exactly one of the dimension keys
 * below is populated depending on which group the row belongs to:
 * - "hour" → `hour`; "day_of_week" → `day_of_week`; "month" → `month`;
 *   "year" → `year`
 * - "cause" → `canonical_cause`; "severity" → `severity`
 * - "county" → `county_code` + `county_name`
 * - "gender"/"at_fault_gender" → `gender`;
 *   "age_bracket"/"at_fault_age_bracket" → `age_bracket`
 * - "weather"/"lighting"/"collision_type" → `value` (or the dimension name)
 */
export interface DimensionRow extends StatsMeasures {
  hour?: number | null;
  day_of_week?: number | null;
  month?: number | null;
  year?: number | null;
  canonical_cause?: string | null;
  severity?: string | null;
  county_code?: number | string | null;
  county_name?: string | null;
  gender?: string | null;
  age_bracket?: string | null;
  value?: string | null;
  weather?: string | null;
  lighting?: string | null;
  collision_type?: string | null;
}

/** Response body of POST /api/stats/batch, keyed by requested group. */
export type StatsBatchResponse = Record<string, DimensionRow[] | undefined>;

/** County-level crash stats row (the "county" group of /api/stats/batch). */
export interface CountyStatsRow extends StatsMeasures {
  county_code?: number | string | null;
  county_name?: string | null;
}

/** Row from GET /api/demographics. */
export interface DemographicsRow {
  county_code?: number | string | null;
  year?: number | null;
  population?: number | null;
  poverty_rate?: number | null;
  median_income?: number | null;
  population_density?: number | null;
  pct_18_24?: number | null;
  pct_65_plus?: number | null;
  commute_drive_alone_pct?: number | null;
  commute_bike_pct?: number | null;
  pct_no_vehicle?: number | null;
  pct_with_disability?: number | null;
}

/** Row from GET /api/calenviroscreen. */
export interface CalEnviroScreenRow {
  county_code?: number | string | null;
  ces_score?: number | null;
  traffic_score?: number | null;
  pollution_burden?: number | null;
  diesel_pm_score?: number | null;
  linguistic_isolation_pct?: number | null;
  housing_burden_pct?: number | null;
  education_pct?: number | null;
  ces_percentile?: number | null;
}

/** Row from GET /api/unemployment. */
export interface UnemploymentRow {
  county_code?: number | string | null;
  year?: number | null;
  unemployment_rate?: number | null;
}

/** Row from GET /api/vehicles. */
export interface VehiclesRow {
  county_code?: number | string | null;
  year?: number | null;
  total_vehicles?: number | null;
  ev_vehicles?: number | null;
}

/** Row from GET /api/weather (one row per county/year/month). */
export interface WeatherRow {
  county_code?: number | string | null;
  year?: number | null;
  avg_temp_f?: number | null;
  precipitation_in?: number | null;
}

/** Row from GET /api/fars. */
export interface FarsRow {
  county_code?: number | string | null;
  year?: number | null;
  fatalities?: number | null;
  unrestrained_killed?: number | null;
  restraint_known_killed?: number | null;
}

/** Row from GET /api/tract-density. */
export interface TractDensityRow {
  county_code?: number | string | null;
  year?: number | null;
  weighted_density?: number | null;
  tract_count?: number | null;
}

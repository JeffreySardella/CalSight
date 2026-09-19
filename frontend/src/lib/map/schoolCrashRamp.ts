import { quantileBuckets, bucketFor } from "../choropleth/binning";

/**
 * Coloring and copy for the school markers, which are tinted by how many
 * crashes happened within 500 ft (see /api/schools/crash-counts).
 *
 * Same shape as lib/map/highwayDanger: a fixed danger ramp, quantile edges
 * over the values actually present, and a no-data color for everything the
 * API didn't return a row for.
 */

/** Light orange -> crimson, matching the highway danger ramp so the two
 *  overlays don't teach the reader two different color languages. */
export const SCHOOL_CRASH_COLORS = ["#fdba74", "#f97316", "#dc2626", "#7f1d1d"] as const;

/** Schools with no crash row at all. Deliberately gray rather than the bottom
 *  of the ramp: "we have no crashes on file here" is a different claim from
 *  "this is the safe end of the scale", and with 37% coordinate coverage it is
 *  very often the former. */
export const SCHOOL_NO_DATA_COLOR = "#9ca3af";

export interface SchoolCrashCount {
  cds_code: string;
  crashes: number;
  killed: number;
  injured: number;
  severe_injured: number;
}

export interface CountyCoordCoverage {
  county_code: number;
  county_name: string | null;
  total_crashes: number;
  crashes_with_coords: number;
  coords_pct: number;
}

export interface SchoolCrashCountsResponse {
  years: number[];
  schools: SchoolCrashCount[];
  coverage: CountyCoordCoverage[];
}

/**
 * Quantile edges over the crash counts present, or null when there are too
 * few distinct schools to bucket meaningfully (see MIN_BUCKET_SUBSET).
 */
export function schoolRampEdges(counts: SchoolCrashCount[]): number[] | null {
  return quantileBuckets(
    counts.map((c) => c.crashes).filter((v) => Number.isFinite(v)),
    SCHOOL_CRASH_COLORS.length,
  );
}

/**
 * Marker color for one school.
 *
 * `undefined` (no row from the API) and 0 both mean "no crashes recorded
 * within 500 ft" and get the no-data gray. With edges unavailable, any school
 * that does have crashes takes the top color — it still reads as "crashes
 * here", which is the honest summary when there's nothing to rank against.
 */
export function schoolCrashColor(value: number | undefined, edges: number[] | null): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return SCHOOL_NO_DATA_COLOR;
  if (!edges) return SCHOOL_CRASH_COLORS[SCHOOL_CRASH_COLORS.length - 1];
  return SCHOOL_CRASH_COLORS[bucketFor(value, edges)];
}

/**
 * The line that keeps this layer honest.
 *
 * Only ~37% of California crashes carry coordinates and the gap tracks the
 * reporting agency, not the year — so a school in a county whose agencies
 * never geocoded shows a low count because the crashes are missing from the
 * map, not because they didn't happen.
 */
export function coverageCaveat(coverage: CountyCoordCoverage | undefined): string | null {
  if (!coverage || !coverage.county_name) return null;
  const pct = Math.round(coverage.coords_pct);
  return `${pct}% of crashes in ${coverage.county_name} have map coordinates; schools in low-coverage counties look safer than they are.`;
}

/** Human label for the year filter behind the counts, for the popup. */
export function yearsLabel(years: number[]): string {
  if (years.length === 0) return "all years";
  if (years.length === 1) return String(years[0]);
  const sorted = [...years].sort((a, b) => a - b);
  return `${sorted[0]}–${sorted[sorted.length - 1]}`;
}

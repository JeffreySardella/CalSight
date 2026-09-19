import { quantileBuckets, bucketFor } from "../choropleth/binning";
import { DANGER_COLORS, DANGER_NO_DATA_COLOR } from "./dangerRamp";

/**
 * Coloring and copy for the school markers, which are tinted by how many
 * crashes happened within 500 ft (see /api/schools/crash-counts).
 *
 * Same shape as lib/map/highwayDanger: the shared danger ramp, quantile edges
 * over the values actually present, and a no-data color for everything the
 * API didn't return a row for.
 */

/** Re-exported under the names this layer reads by. The values live in
 *  lib/map/dangerRamp so the highway layer and this one cannot drift apart —
 *  they were duplicated literals with a comment claiming they matched. */
export { DANGER_COLORS as SCHOOL_CRASH_COLORS, DANGER_NO_DATA_COLOR as SCHOOL_NO_DATA_COLOR };

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
    DANGER_COLORS.length,
  );
}

/**
 * Marker color for one school.
 *
 * `undefined` (no row from the API) and 0 both mean "no crashes recorded
 * within 500 ft" and get the no-data gray. With edges unavailable, any school
 * that does have crashes takes the top color — it still reads as "crashes
 * here", which is the honest summary when there's nothing to rank against.
 *
 * `colors` is the already-resolved ramp (caller does dangerColors + theme),
 * matching how lib/map/highwayDanger takes its palette.
 */
export function schoolCrashColor(
  value: number | undefined,
  edges: number[] | null,
  colors: readonly string[] = DANGER_COLORS,
): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return DANGER_NO_DATA_COLOR;
  if (!edges) return colors[colors.length - 1];
  return colors[bucketFor(value, edges)];
}

/**
 * The line that keeps this layer honest.
 *
 * Only ~37% of California crashes carry coordinates and the gap tracks the
 * reporting agency, not the year — so a school in a county whose agencies
 * never geocoded shows a low count because the crashes are missing from the
 * map, not because they didn't happen.
 *
 * Always returns a sentence. An earlier version returned null when the county
 * had no coverage row, which silently dropped the caveat in exactly the case
 * it matters most: no data-quality row for a county means that county's counts
 * are the least trustworthy on the map, not the most.
 */
export function coverageCaveat(coverage: CountyCoordCoverage | undefined): string {
  const tail = "schools in low-coverage counties look safer than they are.";
  if (!coverage || !coverage.county_name) {
    return `Only crashes with map coordinates (about 37% statewide) are counted; ${tail}`;
  }
  return `${Math.round(coverage.coords_pct)}% of crashes in ${coverage.county_name} have map coordinates; ${tail}`;
}

/** Human label for the year filter behind the counts, for the popup. */
export function yearsLabel(years: number[]): string {
  if (years.length === 0) return "all years";
  if (years.length === 1) return String(years[0]);
  const sorted = [...years].sort((a, b) => a - b);
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  // Only print a range when the set really is every year between the two ends.
  // Today it always is (selectedYears comes from a contiguous date range), but
  // "2019-2023" for {2019, 2021, 2023} would be a lie the moment that changes.
  if (hi - lo + 1 !== sorted.length) return `${sorted.length} years`;
  return `${lo}–${hi}`;
}

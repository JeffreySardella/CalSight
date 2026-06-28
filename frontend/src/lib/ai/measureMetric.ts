import type { DistributionPoint } from "./statNarrative";
import type { FilterSnapshot } from "./dataContext";

export type DistributionMetric =
  | "crash_count" | "total_killed" | "total_injured"
  | "fatal_crashes" | "alcohol_crashes" | "pedestrian_crashes";

const METRICS: ReadonlySet<string> = new Set<DistributionMetric>([
  "crash_count", "total_killed", "total_injured",
  "fatal_crashes", "alcohol_crashes", "pedestrian_crashes",
]);

export function measureToMetric(measure: string): DistributionMetric | null {
  return METRICS.has(measure) ? (measure as DistributionMetric) : null;
}

export function normalizeCounty(name: string): string {
  return name.trim().toLowerCase();
}

/** True when no population-narrowing filter beyond county + year is active, so
 *  the subject value matches the year-only distribution population and the
 *  percentile is honest. (years and counties are intentionally NOT checked
 *  here — year is gated separately and the single county IS the subject.) */
export function distributionPopulationMatches(f: FilterSnapshot): boolean {
  return (
    f.severities.length === 0 &&
    f.causes.length === 0 &&
    f.weather.length === 0 &&
    f.lighting.length === 0 &&
    f.collisionType.length === 0 &&
    f.alcohol == null &&
    f.distracted == null &&
    f.pedestrian == null &&
    f.cyclist == null &&
    f.drug == null &&
    f.roadType == null &&
    f.hitRun == null &&
    f.driverAge == null
  );
}

export type DistributionRow = { county_code: number; county_name: string; value: number };

export function adaptDistribution(rows: DistributionRow[]): DistributionPoint[] {
  return rows.map((r) => ({ id: normalizeCounty(r.county_name), name: r.county_name, value: r.value }));
}

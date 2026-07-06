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

/** The snapshot carries severity display names; the backend's severity parser
 *  accepts only these slugs and 422s on anything else. Same mapping as
 *  useHighwayRankings — unknown values pass through so already-slugged input
 *  keeps working. */
const SEVERITY_SLUG: Record<string, string> = {
  Fatal: "fatal",
  Injury: "injury",
  "Property Damage Only": "property-damage-only",
};

/** Serialize the population-narrowing filters into /api/stats/distribution
 *  query params so the per-county distribution reflects the SAME population as
 *  the subject. `counties` and `years` are deliberately excluded: the
 *  distribution must span every county (else the percentile is meaningless),
 *  and the year is passed separately via the `year` param. */
export function filtersToDistributionParams(f: FilterSnapshot): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.severities.length) {
    out.severity = f.severities.map((s) => SEVERITY_SLUG[s] ?? s).join(",");
  }
  if (f.causes.length) out.cause = f.causes.join(",");
  if (f.weather.length) out.weather = f.weather.join(",");
  if (f.lighting.length) out.lighting = f.lighting.join(",");
  if (f.collisionType.length) out.collision_type = f.collisionType.join(",");
  if (f.alcohol != null) out.alcohol = String(f.alcohol);
  if (f.distracted != null) out.distracted = String(f.distracted);
  if (f.pedestrian != null) out.pedestrian = String(f.pedestrian);
  if (f.cyclist != null) out.cyclist = String(f.cyclist);
  if (f.drug != null) out.drug = String(f.drug);
  if (f.hitRun != null) out.hit_run = String(f.hitRun);
  if (f.driverAge != null) out.driver_age = f.driverAge;
  if (f.roadType != null) out.road_type = f.roadType;
  return out;
}

export type DistributionRow = { county_code: number; county_name: string; value: number };

export function adaptDistribution(rows: DistributionRow[]): DistributionPoint[] {
  return rows.map((r) => ({ id: normalizeCounty(r.county_name), name: r.county_name, value: r.value }));
}

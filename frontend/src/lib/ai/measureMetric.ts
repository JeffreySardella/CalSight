import type { DistributionPoint } from "./statNarrative";

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

export type DistributionRow = { county_code: number; county_name: string; value: number };

export function adaptDistribution(rows: DistributionRow[]): DistributionPoint[] {
  return rows.map((r) => ({ id: normalizeCounty(r.county_name), name: r.county_name, value: r.value }));
}

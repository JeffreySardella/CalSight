export type MeasureKey =
  | "crashes_per_100k"
  | "fatalities_per_100k"
  | "injuries_per_100k"
  | "crashes_raw"
  | "fatality_rate";

export type Measure = {
  key: MeasureKey;
  label: string;
  /** "perCapita" needs demographics; "raw" and "rate" do not. */
  kind: "perCapita" | "raw" | "rate";
  formatLabel: (n: number) => string;
};

export const MEASURES: Record<MeasureKey, Measure> = {
  crashes_per_100k: {
    key: "crashes_per_100k",
    label: "Crashes per 100k residents",
    kind: "perCapita",
    formatLabel: (n) => n.toFixed(0),
  },
  fatalities_per_100k: {
    key: "fatalities_per_100k",
    label: "Fatalities per 100k residents",
    kind: "perCapita",
    formatLabel: (n) => n.toFixed(1),
  },
  injuries_per_100k: {
    key: "injuries_per_100k",
    label: "Injuries per 100k residents",
    kind: "perCapita",
    formatLabel: (n) => n.toFixed(0),
  },
  crashes_raw: {
    key: "crashes_raw",
    label: "Total crashes",
    kind: "raw",
    formatLabel: (n) => n.toLocaleString(),
  },
  fatality_rate: {
    key: "fatality_rate",
    label: "Fatality rate %",
    kind: "rate",
    formatLabel: (n) => `${n.toFixed(1)}%`,
  },
};

export const DEFAULT_MEASURE: MeasureKey = "crashes_per_100k";

/** Floor for per-capita / rate measures. Below this, the denominator
 *  produces noise (e.g. 1 crash / tiny county = implausible per-100k). */
export const MIN_CRASHES_FOR_RATE = 5;

export type CountyStats = {
  county_code: number;
  county_name: string;
  crash_count: number;
  total_killed: number;
  total_injured: number;
};

export type CountyYearDemo = {
  county_code: number;
  year: number;
  population: number | null;
};

export type MeasureResult = {
  value: number | null;
  hasEnoughData: boolean;
};

type ComputeOpts = {
  /** Per-year breakdowns for correct multi-year per-capita math.
   *  When provided, each year's crashes are divided by that year's
   *  population, then summed. When absent, falls back to total / summed-pop
   *  (less accurate when population shifts between years). */
  perYearCrashes?: Map<number, number>;
  perYearFatalities?: Map<number, number>;
  perYearInjuries?: Map<number, number>;
};

export function computeMeasureValue(
  measure: MeasureKey,
  stats: CountyStats,
  demographics: CountyYearDemo[],
  opts: ComputeOpts = {},
): MeasureResult {
  if (measure === "crashes_raw") {
    return { value: stats.crash_count, hasEnoughData: true };
  }
  if (measure === "fatality_rate") {
    if (stats.crash_count < MIN_CRASHES_FOR_RATE) {
      return { value: null, hasEnoughData: false };
    }
    return { value: (stats.total_killed / stats.crash_count) * 100, hasEnoughData: true };
  }

  // Per-capita branches need population.
  if (stats.crash_count < MIN_CRASHES_FOR_RATE) {
    return { value: null, hasEnoughData: false };
  }
  if (demographics.length === 0 || demographics.some((d) => d.population == null)) {
    return { value: null, hasEnoughData: false };
  }

  const numeratorBy = {
    crashes_per_100k: opts.perYearCrashes,
    fatalities_per_100k: opts.perYearFatalities,
    injuries_per_100k: opts.perYearInjuries,
  }[measure];

  if (numeratorBy && numeratorBy.size > 0) {
    let total = 0;
    for (const d of demographics) {
      const numerator = numeratorBy.get(d.year);
      if (numerator == null || d.population == null || d.population === 0) continue;
      total += (numerator / d.population) * 100_000;
    }
    return { value: total, hasEnoughData: true };
  }

  // Fallback — single-year aggregate / summed population.
  const summedPop = demographics.reduce((acc, d) => acc + (d.population ?? 0), 0);
  if (summedPop === 0) return { value: null, hasEnoughData: false };
  const numerator =
    measure === "crashes_per_100k" ? stats.crash_count :
    measure === "fatalities_per_100k" ? stats.total_killed :
    stats.total_injured;
  return { value: (numerator / summedPop) * 100_000, hasEnoughData: true };
}

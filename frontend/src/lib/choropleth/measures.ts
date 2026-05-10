function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

export type MeasureKey =
  | "crashes_per_100k"
  | "fatalities_per_100k"
  | "injuries_per_100k"
  | "crashes_raw"
  | "fatality_rate"
  | "crashes_per_income"
  | "poverty_rate"
  | "median_income"
  | "pct_no_vehicle"
  | "pct_bachelors"
  | "crashes_per_poverty"
  | "pct_65_plus";

export type Measure = {
  key: MeasureKey;
  label: string;
  /** "perCapita" needs demographics; "raw" and "rate" do not. */
  kind: "perCapita" | "raw" | "rate" | "perIncome" | "demographic" | "crashDemographic";
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
    formatLabel: compact,
  },
  fatality_rate: {
    key: "fatality_rate",
    label: "Fatality rate %",
    kind: "rate",
    formatLabel: (n) => `${n.toFixed(1)}%`,
  },
  crashes_per_income: {
    key: "crashes_per_income",
    label: "Crashes per $100K median income",
    kind: "perIncome",
    formatLabel: (n) => n.toFixed(1),
  },
  poverty_rate: {
    key: "poverty_rate",
    label: "Poverty rate %",
    kind: "demographic",
    formatLabel: (n) => `${n.toFixed(1)}%`,
  },
  median_income: {
    key: "median_income",
    label: "Median household income",
    kind: "demographic",
    formatLabel: (n) => `$${compact(n)}`,
  },
  pct_no_vehicle: {
    key: "pct_no_vehicle",
    label: "% households with no vehicle",
    kind: "demographic",
    formatLabel: (n) => `${n.toFixed(1)}%`,
  },
  pct_bachelors: {
    key: "pct_bachelors",
    label: "% bachelor's degree or higher",
    kind: "demographic",
    formatLabel: (n) => `${n.toFixed(1)}%`,
  },
  crashes_per_poverty: {
    key: "crashes_per_poverty",
    label: "Crashes per 1% poverty per 100K",
    kind: "crashDemographic",
    formatLabel: (n) => n.toFixed(1),
  },
  pct_65_plus: {
    key: "pct_65_plus",
    label: "% population age 65+",
    kind: "demographic",
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
  median_income?: number | null;
  poverty_rate?: number | null;
  pct_no_vehicle?: number | null;
  pct_bachelors_or_higher?: number | null;
  pct_65_plus?: number | null;
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

  if (measure === "crashes_per_income") {
    if (stats.crash_count < MIN_CRASHES_FOR_RATE) {
      return { value: null, hasEnoughData: false };
    }
    const incomes = demographics.filter((d) => d.median_income != null && d.median_income > 0);
    if (incomes.length === 0) return { value: null, hasEnoughData: false };
    const avgIncome = incomes.reduce((s, d) => s + d.median_income!, 0) / incomes.length;
    return { value: (stats.crash_count / avgIncome) * 100_000, hasEnoughData: true };
  }

  // Pure demographic measures — return the average across selected years.
  if (measure === "poverty_rate") {
    const vals = demographics.filter((d) => d.poverty_rate != null);
    if (vals.length === 0) return { value: null, hasEnoughData: false };
    return { value: vals.reduce((s, d) => s + d.poverty_rate!, 0) / vals.length, hasEnoughData: true };
  }
  if (measure === "median_income") {
    const vals = demographics.filter((d) => d.median_income != null && d.median_income > 0);
    if (vals.length === 0) return { value: null, hasEnoughData: false };
    return { value: vals.reduce((s, d) => s + d.median_income!, 0) / vals.length, hasEnoughData: true };
  }
  if (measure === "pct_no_vehicle") {
    const vals = demographics.filter((d) => d.pct_no_vehicle != null);
    if (vals.length === 0) return { value: null, hasEnoughData: false };
    return { value: vals.reduce((s, d) => s + d.pct_no_vehicle!, 0) / vals.length, hasEnoughData: true };
  }
  if (measure === "pct_bachelors") {
    const vals = demographics.filter((d) => d.pct_bachelors_or_higher != null);
    if (vals.length === 0) return { value: null, hasEnoughData: false };
    return { value: vals.reduce((s, d) => s + d.pct_bachelors_or_higher!, 0) / vals.length, hasEnoughData: true };
  }
  if (measure === "pct_65_plus") {
    const vals = demographics.filter((d) => d.pct_65_plus != null);
    if (vals.length === 0) return { value: null, hasEnoughData: false };
    return { value: vals.reduce((s, d) => s + d.pct_65_plus!, 0) / vals.length, hasEnoughData: true };
  }

  // Crash-demographic hybrid: crashes per 1% poverty per 100K pop.
  if (measure === "crashes_per_poverty") {
    if (stats.crash_count < MIN_CRASHES_FOR_RATE) {
      return { value: null, hasEnoughData: false };
    }
    const vals = demographics.filter(
      (d) => d.poverty_rate != null && d.poverty_rate > 0 && d.population != null && d.population > 0,
    );
    if (vals.length === 0) return { value: null, hasEnoughData: false };
    const avgPoverty = vals.reduce((s, d) => s + d.poverty_rate!, 0) / vals.length;
    const avgPop = vals.reduce((s, d) => s + d.population!, 0) / vals.length;
    return { value: (stats.crash_count / avgPoverty / avgPop) * 100_000, hasEnoughData: true };
  }

  // Per-capita branches need population.
  if (stats.crash_count < MIN_CRASHES_FOR_RATE) {
    return { value: null, hasEnoughData: false };
  }
  if (demographics.length === 0 || demographics.some((d) => d.population == null)) {
    return { value: null, hasEnoughData: false };
  }

  const numeratorBy = ({
    crashes_per_100k: opts.perYearCrashes,
    fatalities_per_100k: opts.perYearFatalities,
    injuries_per_100k: opts.perYearInjuries,
  } as Record<string, Map<number, number> | undefined>)[measure];

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

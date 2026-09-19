function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

export type MeasureKey =
  | "crashes_per_100k"
  | "fatalities_per_100k"
  | "injuries_per_100k"
  | "crashes_per_10k_drivers"
  | "fatalities_per_10k_drivers"
  | "crashes_per_100_road_miles"
  | "crashes_per_100m_vmt"
  | "crashes_raw"
  | "fatality_rate"
  | "crashes_per_income"
  | "poverty_rate"
  | "median_income"
  | "pct_no_vehicle"
  | "pct_bachelors"
  | "crashes_per_poverty"
  | "pct_65_plus"
  | "ces_score"
  | "pollution_burden"
  | "traffic_score"
  | "unemployment_rate";

export type Measure = {
  key: MeasureKey;
  label: string;
  /** "perCapita" needs demographics; "raw" and "rate" do not.
   *  "context" measures are sourced from external datasets
   *  (CalEnviroScreen, unemployment) rather than crash/demo queries. */
  kind: "perCapita" | "perDriver" | "perRoadMile" | "perVmt" | "raw" | "rate" | "perIncome" | "demographic" | "crashDemographic" | "context";
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
  crashes_per_10k_drivers: {
    key: "crashes_per_10k_drivers",
    label: "Crashes per 10k licensed drivers",
    kind: "perDriver",
    formatLabel: (n) => n.toFixed(0),
  },
  fatalities_per_10k_drivers: {
    key: "fatalities_per_10k_drivers",
    label: "Fatalities per 10k licensed drivers",
    kind: "perDriver",
    formatLabel: (n) => n.toFixed(2),
  },
  crashes_per_100_road_miles: {
    key: "crashes_per_100_road_miles",
    label: "Crashes per 100 road miles",
    kind: "perRoadMile",
    formatLabel: (n) => n.toFixed(0),
  },
  crashes_per_100m_vmt: {
    key: "crashes_per_100m_vmt",
    label: "Crashes per 100M vehicle miles",
    kind: "perVmt",
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
  ces_score: {
    key: "ces_score",
    label: "CalEnviroScreen score",
    kind: "context",
    formatLabel: (n) => n.toFixed(1),
  },
  pollution_burden: {
    key: "pollution_burden",
    label: "Pollution burden score",
    kind: "context",
    formatLabel: (n) => n.toFixed(1),
  },
  traffic_score: {
    key: "traffic_score",
    label: "Traffic proximity score",
    kind: "context",
    formatLabel: (n) => n.toFixed(1),
  },
  unemployment_rate: {
    key: "unemployment_rate",
    label: "Average unemployment rate",
    kind: "context",
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

/** Pre-computed context values from external datasets (CalEnviroScreen,
 *  unemployment) that don't come from the crash stats or demographics
 *  endpoints. Keyed by the context MeasureKey. */
export type ContextValues = Partial<Record<MeasureKey, number | null>>;

type ComputeOpts = {
  /** Per-year breakdowns for correct multi-year per-capita math.
   *  When provided, each year's crashes are divided by that year's
   *  population, then summed. When absent, falls back to total / summed-pop
   *  (less accurate when population shifts between years). */
  perYearCrashes?: Map<number, number>;
  perYearFatalities?: Map<number, number>;
  perYearInjuries?: Map<number, number>;
  /** External dataset values for "context" kind measures. */
  context?: ContextValues;
  /** Average licensed drivers per year over the selected window (perDriver). */
  annualDrivers?: number | null;
  /** Total road miles in the county, all functional classes (perRoadMile). */
  roadMiles?: number | null;
  /** Average millions of vehicle miles driven per year over the selected
   *  window (perVmt). */
  annualVmtMillions?: number | null;
  /** Years the crash total spans, so perDriver / perRoadMile / perVmt are
   *  annual rates like the per-100k ones. */
  yearCount?: number;
};

export type DriverYear = { year: number; driver_count: number | null };
export type VmtYear = { year: number; vmt_millions: number | null };

/** Average of a yearly denominator over the selected years (empty set = all).
 *  Both exposure denominators are published on their own schedules and
 *  neither covers every crash year, so when no selected year has data the
 *  nearest available year stands in — these quantities move slowly enough
 *  that a neighbouring year beats showing nothing. One rule, so tuning it
 *  cannot drift between the two callers. */
function annualAverage(
  rows: { year: number; value: number | null }[],
  years: Set<number>,
): number | null {
  const valid = rows.filter((r) => r.value != null && r.value > 0);
  if (valid.length === 0) return null;
  let pick = years.size > 0 ? valid.filter((r) => years.has(r.year)) : valid;
  if (pick.length === 0) {
    const target = Math.max(...years);
    pick = [valid.reduce((a, b) => (Math.abs(b.year - target) < Math.abs(a.year - target) ? b : a))];
  }
  return pick.reduce((sum, r) => sum + r.value!, 0) / pick.length;
}

/** Average licensed drivers per year. DMV coverage is 2008-2024. */
export function annualDriverCount(rows: DriverYear[], years: Set<number>): number | null {
  return annualAverage(rows.map((r) => ({ year: r.year, value: r.driver_count })), years);
}

/** Average VMT (millions) per year. EMFAC coverage starts in 2001 and stops
 *  before the current year, since later years are forecasts. */
export function annualVmtMillions(rows: VmtYear[], years: Set<number>): number | null {
  return annualAverage(rows.map((r) => ({ year: r.year, value: r.vmt_millions })), years);
}

export function computeMeasureValue(
  measure: MeasureKey,
  stats: CountyStats,
  demographics: CountyYearDemo[],
  opts: ComputeOpts = {},
): MeasureResult {
  // Context measures are pre-computed from external datasets and passed
  // through opts.context — no crash stats or demographics needed.
  if (MEASURES[measure]?.kind === "context") {
    const v = opts.context?.[measure];
    if (v == null) return { value: null, hasEnoughData: false };
    return { value: v, hasEnoughData: true };
  }

  // Exposure denominators: who drives (DMV) and how much road there is
  // (Caltrans). Annualized over the selected years, same floor as per-100k.
  if (measure === "crashes_per_10k_drivers" || measure === "fatalities_per_10k_drivers") {
    const drivers = opts.annualDrivers;
    const years = opts.yearCount ?? 1;
    if (stats.crash_count < MIN_CRASHES_FOR_RATE || drivers == null || drivers <= 0 || years <= 0) {
      return { value: null, hasEnoughData: false };
    }
    const numerator = measure === "crashes_per_10k_drivers" ? stats.crash_count : stats.total_killed;
    return { value: (numerator / (drivers * years)) * 10_000, hasEnoughData: true };
  }
  if (measure === "crashes_per_100_road_miles") {
    const miles = opts.roadMiles;
    const years = opts.yearCount ?? 1;
    if (stats.crash_count < MIN_CRASHES_FOR_RATE || miles == null || miles <= 0 || years <= 0) {
      return { value: null, hasEnoughData: false };
    }
    return { value: (stats.crash_count / (miles * years)) * 100, hasEnoughData: true };
  }
  if (measure === "crashes_per_100m_vmt") {
    const vmtMillions = opts.annualVmtMillions;
    const years = opts.yearCount ?? 1;
    if (stats.crash_count < MIN_CRASHES_FOR_RATE || vmtMillions == null || vmtMillions <= 0 || years <= 0) {
      return { value: null, hasEnoughData: false };
    }
    // vmt_millions is per year, so multiplying by the year count gives the
    // miles driven over the whole window; 100M miles = 100 of those units.
    return { value: (stats.crash_count / (vmtMillions * years)) * 100, hasEnoughData: true };
  }

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
    if (avgPoverty <= 0 || avgPop <= 0) return { value: null, hasEnoughData: false };
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

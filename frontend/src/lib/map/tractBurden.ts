/** Shared shapes and colour rules for the census-tract equity layer.
 *
 * Kept out of the hook so the layer, the legend and their tests agree on one
 * definition of "most burdened" and of "we cannot express this tract in the
 * ramp's units".
 */

export type TractBurdenRow = {
  geoid: string;
  county_code: number;
  ces_percentile: number | null;
  crash_count: number;
  killed: number;
  injured: number;
  /** Null when CalEnviroScreen carried no population for the tract. Not zero. */
  crashes_per_1k_pop: number | null;
};

type TractBurdenSummary = {
  /** 0-1 share of crashes in these years that have coordinates at all. */
  coord_share: number | null;
  tract_count: number;
  start_year: number | null;
  end_year: number | null;
  /** Whether the ramp can be a rate at all — not whether every tract has one. */
  population_available: boolean;
  /** Tracts with no population, which can only show a count. */
  tracts_without_population: number;
};

export type TractBurden = {
  summary: TractBurdenSummary;
  tracts: TractBurdenRow[];
};

/** CES percentile at or above which a tract counts as most-burdened. */
export const CES_TOP_QUARTILE = 75;

/**
 * Outline for tracts in the top CES quartile.
 *
 * Deliberately not a fixed accent: the first version used `#f59e0b`, which is
 * the middle step of BOTH the warm light and warm dark ramps — with that
 * palette selected the "most burdened" outline was the same hex as a
 * mid-burden fill, and the legend's swatch matched the block above it. Plain
 * black/white reads against all four ramps in both themes.
 */
export function cesHighlightColor(isDark: boolean): string {
  return isDark ? "#ffffff" : "#111111";
}

/**
 * Fill for a tract the ramp cannot express — no CES population while the ramp
 * is a rate. A neutral grey, never opacity 0: an invisible tract is
 * indistinguishable from one the API never returned.
 */
export function noDataFill(isDark: boolean): string {
  return isDark ? "#57534e" : "#a8a29e";
}

/**
 * The value the map colours by: crashes per 1,000 residents when the response
 * supports a rate, raw crash count otherwise.
 *
 * Raw counts mostly measure how many people live (and drive) in a tract, so
 * the rate is the honest default and the count is the fallback, not a choice.
 *
 * Returns null for a tract with no population while `rateMode` is on — the
 * caller must render that as no-data and label its number as a count.
 */
export function burdenValue(
  row: TractBurdenRow,
  rateMode: boolean,
): number | null {
  return rateMode ? row.crashes_per_1k_pop : row.crash_count;
}

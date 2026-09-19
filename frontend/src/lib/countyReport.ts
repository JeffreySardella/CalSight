/**
 * Number work behind the printable county report card (/county/:slug/report).
 *
 * Kept out of the page component so the rate floor, the change arithmetic and
 * the display formatting are unit-testable without rendering anything or
 * mocking a fetch. Nothing here knows about React or the API shapes.
 *
 * Rates reuse the map's existing floor (MIN_CRASHES_FOR_RATE): below it a
 * per-driver or per-mile figure is noise, and a report card aimed at
 * journalists should say so rather than print a confident-looking number.
 */

import { MIN_CRASHES_FOR_RATE } from "./choropleth/measures";
import { isPartialYear } from "./partialYear";
import { CAUSES } from "../hooks/useFilterParams";

/** Years drawn in the trend chart, and the window the hour/factor panels cover. */
export const REPORT_WINDOW_YEARS = 10;
/** The report compares the latest complete year against this many years earlier. */
export const CHANGE_LOOKBACK_YEARS = 5;

export type Rate = {
  value: number | null;
  /** True when the count is under the app's floor for showing a rate at all. */
  tooSmall: boolean;
};

/** Denominator missing (DMV or Caltrans has no row) — different from "too small". */
const UNAVAILABLE: Rate = { value: null, tooSmall: false };

/**
 * A rate, suppressed when the crash count is under the shared floor, or when
 * the denominator is missing. The two cases read differently on the page.
 */
export function rate(
  crashes: number,
  numerator: number,
  denominator: number | null | undefined,
  per: number,
): Rate {
  if (crashes < MIN_CRASHES_FOR_RATE) return { value: null, tooSmall: true };
  if (denominator == null || denominator <= 0) return UNAVAILABLE;
  return { value: (numerator / denominator) * per, tooSmall: false };
}

/** The most recent year that is not the in-progress calendar year. */
export function latestCompleteYear(years: Iterable<number>): number | null {
  const complete = [...years].filter((y) => !isPartialYear(y));
  return complete.length ? Math.max(...complete) : null;
}

/** Percent change from `then` to `now`. Null when either side is unusable. */
export function changePct(then: number | null, now: number | null): number | null {
  if (then == null || now == null || then === 0) return null;
  return ((now - then) / then) * 100;
}

export function formatCount(n: number | null): string {
  return n == null ? "—" : Math.round(n).toLocaleString("en-US");
}

export function formatValue(n: number | null, decimals: number): string {
  return n == null ? "—" : n.toFixed(decimals);
}

/** Signed percent for display. Uses a true minus sign, not a hyphen. */
export function formatChange(pct: number | null): string {
  if (pct == null) return "—";
  if (Math.abs(pct) < 0.05) return "no change";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`;
}

export function ordinal(n: number): string {
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** Position of `code` when the counties are ordered highest value first. */
export function rankOf(
  values: Array<{ code: number; value: number | null }>,
  code: number,
): { rank: number; of: number } | null {
  const ranked = values
    .filter((v): v is { code: number; value: number } => v.value != null)
    .sort((a, b) => b.value - a.value);
  const i = ranked.findIndex((v) => v.code === code);
  return i === -1 ? null : { rank: i + 1, of: ranked.length };
}

// The API returns canonical_cause with underscores; CAUSES carries the display
// labels against hyphenated slugs. Deriving the map keeps the two in step
// instead of copying an eleventh private lookup table into this file.
const FACTOR_LABELS = new Map(CAUSES.map((c) => [c.value.replace(/-/g, "_"), c.label as string]));

/** Display label for a canonical_cause value from the API. */
export function factorLabel(canonical: string): string {
  return (
    FACTOR_LABELS.get(canonical) ??
    canonical.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase())
  );
}

export type YearTotals = { crashes: number; killed: number; injured: number };

export type AreaInputs = {
  now: YearTotals;
  then: YearTotals;
  /** Licensed drivers in the latest complete year (nearest year stands in). */
  drivers: number | null;
  /** Licensed drivers five years earlier. */
  priorDrivers: number | null;
  /** Caltrans road miles, all functional classes. Not published per year. */
  roadMiles: number | null;
};

export type ReportInputs = { county: AreaInputs; statewide: AreaInputs };

export type MetricRow = {
  key: string;
  label: string;
  /** Latest complete year, county. Null when suppressed or unavailable. */
  county: number | null;
  /** True when the county value is hidden by the small-count floor. */
  countyTooSmall: boolean;
  /** Same measure, statewide, for context. */
  statewide: number | null;
  /** Change against five years earlier, county, in percent. */
  changePct: number | null;
  decimals: number;
};

const EMPTY_TOTALS: YearTotals = { crashes: 0, killed: 0, injured: 0 };

function area(a: AreaInputs | undefined): AreaInputs {
  return (
    a ?? { now: EMPTY_TOTALS, then: EMPTY_TOTALS, drivers: null, priorDrivers: null, roadMiles: null }
  );
}

/** The six headline numbers, county beside statewide, with the five-year change. */
export function buildMetrics(inputs: ReportInputs): MetricRow[] {
  const c = area(inputs.county);
  const s = area(inputs.statewide);

  const deaths = (t: YearTotals) => rate(t.crashes, t.killed, t.crashes, 1_000);
  const perDriver = (t: YearTotals, drivers: number | null) =>
    rate(t.crashes, t.crashes, drivers, 10_000);
  const perMile = (t: YearTotals, miles: number | null) => rate(t.crashes, t.crashes, miles, 100);

  const countRow = (
    key: string,
    label: string,
    pick: (t: YearTotals) => number,
  ): MetricRow => ({
    key,
    label,
    county: pick(c.now),
    countyTooSmall: false,
    statewide: pick(s.now),
    changePct: changePct(pick(c.then), pick(c.now)),
    decimals: 0,
  });

  const rateRow = (
    key: string,
    label: string,
    decimals: number,
    now: Rate,
    then: Rate,
    state: Rate,
  ): MetricRow => ({
    key,
    label,
    county: now.value,
    countyTooSmall: now.tooSmall,
    statewide: state.value,
    changePct: changePct(then.value, now.value),
    decimals,
  });

  return [
    countRow("crashes", "Crashes", (t) => t.crashes),
    countRow("deaths", "People killed", (t) => t.killed),
    countRow("injuries", "People injured", (t) => t.injured),
    rateRow(
      "deaths_per_1k",
      "Deaths per 1,000 crashes",
      1,
      deaths(c.now),
      deaths(c.then),
      deaths(s.now),
    ),
    rateRow(
      "per_10k_drivers",
      "Crashes per 10,000 licensed drivers",
      1,
      perDriver(c.now, c.drivers),
      perDriver(c.then, c.priorDrivers),
      perDriver(s.now, s.drivers),
    ),
    rateRow(
      "per_100_miles",
      "Crashes per 100 road miles",
      1,
      perMile(c.now, c.roadMiles),
      perMile(c.then, c.roadMiles),
      perMile(s.now, s.roadMiles),
    ),
  ];
}

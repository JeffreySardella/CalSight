/**
 * Number work behind the printable county report card (/county/:slug/report).
 *
 * Kept out of the page component so the rate floors, the change arithmetic and
 * the display formatting are unit-testable without rendering anything or
 * mocking a fetch. Nothing here knows about React or the API shapes.
 *
 * Why this page has its own floors rather than the map's MIN_CRASHES_FOR_RATE:
 * the map shades 58 cells and a reader compares them by colour, so a floor of a
 * handful of crashes is enough to stop a cell shouting. A report card prints
 * one number as a sentence, and there the noise lives in the NUMERATOR.
 * Alpine's 2 deaths in 68 crashes is a perfectly real count, but "29.4 deaths
 * per 1,000 crashes" is one collision away from 14.7 or 44.1 and reads as a
 * finding. So the death rate is gated on deaths and the exposure rates on
 * crashes, both well above the map's floor, and a withheld rate names the
 * count that was too small instead of printing a confident-looking number.
 * The map's own floor is deliberately left alone.
 */

import { isPartialYear } from "./partialYear";
import { CAUSES } from "../hooks/useFilterParams";

/** Years drawn in the trend chart, and the window the hour/factor panels cover. */
export const REPORT_WINDOW_YEARS = 10;
/** The report compares the latest complete year against this many years earlier. */
export const CHANGE_LOOKBACK_YEARS = 5;
/** Years summed for the pooled death rate offered to small counties. */
export const POOLED_YEARS = 5;

/** Deaths needed in the year before a deaths-per-1,000-crashes rate is printed. */
export const MIN_DEATHS_FOR_DEATH_RATE = 10;
/** Crashes needed in the year before a per-driver or per-mile rate is printed. */
export const MIN_CRASHES_FOR_CRASH_RATE = 50;

/** Which count was too small to publish a rate, when one was. */
export type Suppression = "deaths" | "crashes" | null;

export type Rate = {
  value: number | null;
  suppressedBy: Suppression;
};

/** Denominator missing (DMV or Caltrans has no row) — not a small-county case. */
const UNAVAILABLE: Rate = { value: null, suppressedBy: null };

/**
 * A rate, withheld when the count it rests on is too small, or when the
 * denominator is missing. The two cases read differently on the page: one is a
 * statement about the county, the other a gap in an external dataset.
 */
export function rate(
  gate: { count: number; min: number; kind: "deaths" | "crashes" },
  numerator: number,
  denominator: number | null | undefined,
  per: number,
): Rate {
  if (gate.count < gate.min) return { value: null, suppressedBy: gate.kind };
  if (denominator == null || denominator <= 0) return UNAVAILABLE;
  return { value: (numerator / denominator) * per, suppressedBy: null };
}

/** Deaths per 1,000 crashes for one year, gated on the death count. */
export function deathRate(t: YearTotals): Rate {
  return rate(
    { count: t.killed, min: MIN_DEATHS_FOR_DEATH_RATE, kind: "deaths" },
    t.killed,
    t.crashes,
    1_000,
  );
}

export type PooledDeathRate = {
  /** Null when even the pooled deaths fall short of the threshold. */
  value: number | null;
  deaths: number;
  crashes: number;
  fromYear: number;
  toYear: number;
};

/**
 * Deaths per 1,000 crashes over several years summed together.
 *
 * A county with two deaths a year has no usable annual rate, but five years of
 * them often clears the same threshold, and a pooled figure is a real number
 * where the annual one is a blank. Summed first and divided once — averaging
 * five annual rates would let the lightest year swing the answer.
 */
export function pooledDeathRate(
  rows: Array<{ year: number; crashes: number; killed: number }>,
): PooledDeathRate | null {
  const years = [...rows].sort((a, b) => a.year - b.year).slice(-POOLED_YEARS);
  if (years.length === 0) return null;
  const deaths = years.reduce((s, r) => s + r.killed, 0);
  const crashes = years.reduce((s, r) => s + r.crashes, 0);
  return {
    value: deaths >= MIN_DEATHS_FOR_DEATH_RATE && crashes > 0 ? (deaths / crashes) * 1_000 : null,
    deaths,
    crashes,
    fromYear: years[0].year,
    toYear: years[years.length - 1].year,
  };
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
  /** Latest complete year, county. Null when withheld or unavailable. */
  county: number | null;
  /** Which county count was too small to print this rate, when one was. */
  suppressedBy: Suppression;
  /** Same measure, statewide, for context. Never withheld — the statewide
   *  counts clear both floors by orders of magnitude. */
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

  const crashGate = (t: YearTotals) => ({
    count: t.crashes,
    min: MIN_CRASHES_FOR_CRASH_RATE,
    kind: "crashes" as const,
  });
  const perDriver = (t: YearTotals, drivers: number | null) =>
    rate(crashGate(t), t.crashes, drivers, 10_000);
  const perMile = (t: YearTotals, miles: number | null) =>
    rate(crashGate(t), t.crashes, miles, 100);

  const countRow = (
    key: string,
    label: string,
    pick: (t: YearTotals) => number,
  ): MetricRow => ({
    key,
    label,
    county: pick(c.now),
    suppressedBy: null,
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
    suppressedBy: now.suppressedBy,
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
      deathRate(c.now),
      deathRate(c.then),
      deathRate(s.now),
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

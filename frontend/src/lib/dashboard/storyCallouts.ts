/**
 * Stat-callout figures for the data stories, computed from live API data.
 *
 * The callouts used to be hand-typed strings ("4.1x", "-31%"), and they
 * drifted from the data every time a crash year loaded or late death records
 * arrived (#461). Each function here takes the JSON bodies a callout's
 * `sources` return (see stories.ts) and derives the headline number and the
 * sentence under it, so the text can only say what the data says today.
 *
 * A function throws when its data is missing; StoryReader renders that as
 * "figure unavailable" rather than a zero or NaN.
 */
import type { CalEnviroScreenRow, DemographicsRow, DimensionRow, VehiclesRow } from "../../types/api";
import { isPartialYear } from "../partialYear";
import { isProvisionalDeathYear } from "./provisionalDeaths";
import { median, pearsonR } from "./stats";

export type CalloutFigure = {
  value: string;
  context: string;
  /** Replaces the block's label when the label itself names data years. */
  label?: string;
};

type Rows = DimensionRow[];
type Measure = "crash_count" | "total_killed" | "party_count";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function need(ok: unknown, what: string): asserts ok {
  if (!ok) throw new Error(`story callout: missing ${what}`);
}

const num = (n: number) => Math.round(n).toLocaleString("en-US");
const sum = (rows: Rows, key: Measure) => rows.reduce((s, r) => s + (r[key] ?? 0), 0);
const pctChange = (from: number, to: number) => ((to - from) / from) * 100;
/** "+338%" / "-31%" */
const signed = (pct: number) => `${Math.round(pct) > 0 ? "+" : ""}${Math.round(pct)}%`;
/** "fell 26%" / "rose 4%" */
const moved = (pct: number) => `${pct < 0 ? "fell" : "rose"} ${Math.abs(Math.round(pct))}%`;

/** Year rows without the in-progress year, oldest first. */
function closedYears(rows: Rows): Array<DimensionRow & { year: number }> {
  return rows
    .filter((r): r is DimensionRow & { year: number } => r.year != null && !isPartialYear(r.year))
    .sort((a, b) => a.year - b.year);
}

function maxBy<T>(rows: T[], f: (r: T) => number): T {
  return rows.reduce((best, r) => (f(r) > f(best) ? r : best));
}

function hourLabel(h: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${h < 12 ? "AM" : "PM"}`;
}

/** Deaths per 1,000 crashes, per county, keyed by county code. */
function countyRates(counties: Rows): Map<string, number> {
  const rates = new Map<string, number>();
  for (const r of counties) {
    if (r.county_code != null && (r.crash_count ?? 0) > 0) {
      rates.set(String(r.county_code), (1000 * (r.total_killed ?? 0)) / r.crash_count!);
    }
  }
  return rates;
}

function correlationStrength(r: number): string {
  const a = Math.abs(r);
  if (a < 0.2) return "Close to no relationship";
  if (a < 0.4) return "A weak relationship";
  if (a < 0.7) return "A moderate relationship";
  return "A strong relationship";
}

/** Two Californias: deaths per crash, five rural counties vs five urban ones. */
export function twoCaliforniasCallout(ruralYears: Rows, urbanYears: Rows): CalloutFigure {
  const rural = closedYears(ruralYears);
  const urban = closedYears(urbanYears);
  need(rural.length && urban.length && sum(urban, "crash_count") && sum(rural, "crash_count"), "county years");
  const rate = (rows: Rows) => (1000 * sum(rows, "total_killed")) / sum(rows, "crash_count");
  const r = rate(rural);
  const u = rate(urban);
  need(u > 0, "urban deaths");
  return {
    value: `${(r / u).toFixed(1)}x`,
    context:
      `In the five rural counties below, ${r.toFixed(1)} people died per 1,000 crashes, against ` +
      `${u.toFixed(1)} in the five urban ones (${rural[0].year} to ${rural[rural.length - 1].year})`,
  };
}

/** DUI Clock: the peak hour, the late-night share, and the worst days. */
export function duiClockCallout(hours: Rows, days: Rows): CalloutFigure {
  need(hours.length && days.length >= 2, "hour and day rows");
  const total = sum(hours, "crash_count");
  need(total > 0, "alcohol-involved crashes");
  const peak = maxBy(hours, (r) => r.crash_count ?? 0);
  const lateNight = hours.filter((r) => [22, 23, 0, 1, 2].includes(r.hour ?? -1));
  const share = Math.round((100 * sum(lateNight, "crash_count")) / total);

  const [a, b] = [...days].sort((x, y) => (y.crash_count ?? 0) - (x.crash_count ?? 0));
  const name = (r: DimensionRow) => DAY_NAMES[r.day_of_week ?? -1] ?? `day ${r.day_of_week}`;
  // Within 1% of each other reads as a tie, not a ranking.
  const tied = (a.crash_count ?? 0) - (b.crash_count ?? 0) < 0.01 * (a.crash_count ?? 0);
  const [first, second] = [a, b].sort((x, y) => (x.day_of_week ?? 0) - (y.day_of_week ?? 0));
  const daysText = tied
    ? `${name(first)} and ${name(second)} are effectively tied as the worst days`
    : `${name(a)} is the worst day, ahead of ${name(b)}`;

  return {
    value: hourLabel(peak.hour ?? 0),
    context: `${share}% of alcohol-involved crashes fall between 10 PM and 3 AM. ${daysText}`,
  };
}

/** Twenty Years: crashes from their peak to their later low, and where deaths went. */
export function twentyYearsCallout(years: Rows): CalloutFigure {
  const closed = closedYears(years);
  need(closed.length >= 2, "year rows");
  const peak = maxBy(closed, (r) => r.crash_count ?? 0);
  const after = closed.filter((r) => r.year > peak.year);
  need(after.length, "years after the crash peak");
  const low = maxBy(after, (r) => -(r.crash_count ?? 0));
  const deathPeak = maxBy(closed, (r) => r.total_killed ?? 0);
  const last = closed[closed.length - 1];

  let deaths = `they peaked at ${num(deathPeak.total_killed ?? 0)} in ${deathPeak.year}`;
  if (deathPeak.year !== last.year) deaths += ` and stood at ${num(last.total_killed ?? 0)} in ${last.year}`;
  if (isProvisionalDeathYear(last.year)) deaths += ", a figure still rising as late death records arrive";

  return {
    label: `Crashes, ${peak.year} peak to ${low.year} low`,
    value: signed(pctChange(peak.crash_count ?? 0, low.crash_count ?? 0)),
    context:
      `From ${num(peak.crash_count ?? 0)} crashes in ${peak.year} to ${num(low.crash_count ?? 0)} in ` +
      `${low.year}. Deaths moved differently: ${deaths}`,
  };
}

/** Poverty: county poverty rate vs deaths per crash. Uses each county's most
 *  recent poverty rate, the same pick the correlation matrix makes. */
export function povertyCallout(counties: Rows, demographics: DemographicsRow[], period: string): CalloutFigure {
  const latest = new Map<string, DemographicsRow>();
  for (const d of demographics) {
    if (d.county_code == null || d.poverty_rate == null) continue;
    const key = String(d.county_code);
    const seen = latest.get(key);
    if (!seen || (d.year ?? 0) > (seen.year ?? 0)) latest.set(key, d);
  }
  const rates = countyRates(counties);
  const pairs = [...rates].flatMap(([code, rate]) => {
    const d = latest.get(code);
    return d ? [{ poverty: d.poverty_rate!, rate, year: d.year ?? 0 }] : [];
  });
  need(pairs.length >= 5, "county poverty rates");

  const r = pearsonR(pairs.map((p) => p.poverty), pairs.map((p) => p.rate));
  const poorest = [...pairs].sort((x, y) => y.poverty - x.poverty).slice(0, Math.ceil(pairs.length / 4));
  const poorMedian = median(poorest.map((p) => p.rate));
  const allMedian = median(pairs.map((p) => p.rate));
  const povertyYear = Math.max(...pairs.map((p) => p.year));

  return {
    value: `r = ${r.toFixed(2)}`,
    context:
      `Across ${pairs.length} counties: deaths per crash over ${period}, against each county's ` +
      `${povertyYear} poverty rate. The poorest quarter of counties had a median of ` +
      `${poorMedian.toFixed(1)} deaths per 1,000 crashes, ${(poorMedian / allMedian).toFixed(2)} times the median county`,
  };
}

/** EVs: registrations from the first year on record to the last full crash
 *  year, beside pedestrian deaths over the same years. */
export function evCallout(vehicles: VehiclesRow[], pedestrianYears: Rows): CalloutFigure {
  const ev = new Map<number, number>();
  for (const v of vehicles) {
    if (v.year != null && v.ev_vehicles != null) ev.set(v.year, (ev.get(v.year) ?? 0) + v.ev_vehicles);
  }
  const first = Math.min(...ev.keys());
  const lastYear = Math.max(...closedYears(pedestrianYears).map((r) => r.year).filter((y) => ev.has(y)));
  const ped = closedYears(pedestrianYears).filter((r) => r.year >= first && r.year <= lastYear);
  need(ped.length >= 2 && ped[0].year === first, "EV and pedestrian years");
  const last = ped[ped.length - 1];
  const pedPeak = maxBy(ped, (r) => r.total_killed ?? 0);

  let deaths = `pedestrian deaths went from ${num(ped[0].total_killed ?? 0)} to ${num(last.total_killed ?? 0)}`;
  if (pedPeak.year !== first && pedPeak.year !== last.year) {
    deaths += `, peaking at ${num(pedPeak.total_killed ?? 0)} in ${pedPeak.year}`;
  }
  if (isProvisionalDeathYear(last.year)) deaths += ` (${last.year} still preliminary)`;

  return {
    label: `EV registrations, ${first} to ${last.year}`,
    value: signed(pctChange(ev.get(first)!, ev.get(last.year)!)),
    context: `From ${num(ev.get(first)!)} to ${num(ev.get(last.year)!)}. Over the same years, ${deaths}`,
  };
}

/** WFH: 7 to 9 AM crashes (the 7:00 and 8:00 hours) across two years,
 *  statewide and in the Bay Area tech counties. */
export function wfhCallout(stateBefore: Rows, stateAfter: Rows, bayBefore: Rows, bayAfter: Rows): CalloutFigure {
  const morning = (rows: Rows) => sum(rows.filter((r) => r.hour === 7 || r.hour === 8), "crash_count");
  const [s0, s1, b0, b1] = [stateBefore, stateAfter, bayBefore, bayAfter].map(morning);
  need(s0 > 0 && b0 > 0, "morning crash counts");
  return {
    value: signed(pctChange(s0, s1)),
    context: `Statewide, from ${num(s0)} to ${num(s1)}. The five Bay Area tech counties ${moved(pctChange(b0, b1))}`,
  };
}

/** Young drivers: 18 to 24 share of at-fault drivers with a known age, beside
 *  the group's share of the population. */
export function youngDriversCallout(ageRows: Rows, demographics: DemographicsRow[]): CalloutFigure {
  const known = ageRows.filter((r) => r.age_bracket && r.age_bracket !== "unknown");
  const knownTotal = sum(known, "party_count");
  const all = sum(ageRows, "party_count");
  const young = sum(known.filter((r) => r.age_bracket === "18_24"), "party_count");
  need(knownTotal > 0, "at-fault ages");

  const withAge = demographics.filter((d) => d.pct_18_24 != null && (d.population ?? 0) > 0);
  need(withAge.length, "population by age");
  const year = Math.max(...withAge.map((d) => d.year ?? 0));
  const thatYear = withAge.filter((d) => d.year === year);
  const population = thatYear.reduce((s, d) => s + d.population!, 0);
  const popShare = thatYear.reduce((s, d) => s + d.pct_18_24! * d.population!, 0) / population;

  return {
    value: `${Math.round((100 * young) / knownTotal)}%`,
    context:
      `Among at-fault drivers with a recorded age. The group is about ${popShare.toFixed(1)}% of ` +
      `Californians (${year}), and ${Math.round((100 * (all - knownTotal)) / all)}% of at-fault driver records have no age`,
  };
}

/** Seasonal: October vs February deaths, in total and per day. */
export function seasonalCallout(months: Rows, firstYear: number, lastYear: number): CalloutFigure {
  const killed = (m: number) => months.find((r) => r.month === m)?.total_killed ?? 0;
  const oct = killed(10);
  const feb = killed(2);
  need(oct > 0 && feb > 0, "October and February deaths");
  let febDays = 0;
  for (let y = firstYear; y <= lastYear; y++) febDays += new Date(y, 2, 0).getDate();
  const octDays = 31 * (lastYear - firstYear + 1);
  const perDay = pctChange(feb / febDays, oct / octDays);
  return {
    value: signed(pctChange(feb, oct)),
    context:
      `Over ${firstYear} to ${lastYear}. Part of that is the calendar, since February is short: per day, ` +
      `October runs ${Math.abs(Math.round(perDay))}% ${perDay < 0 ? "below" : "above"} February`,
  };
}

/** Environmental justice: county CalEnviroScreen score vs deaths per crash. */
export function calEnviroScreenCallout(counties: Rows, ces: CalEnviroScreenRow[], period: string): CalloutFigure {
  const rates = countyRates(counties);
  const pairs = ces.flatMap((c) => {
    const rate = rates.get(String(c.county_code));
    return c.ces_score != null && rate != null ? [[c.ces_score, rate]] : [];
  });
  need(pairs.length >= 5, "county CalEnviroScreen scores");
  const r = pearsonR(pairs.map((p) => p[0]), pairs.map((p) => p[1]));
  return {
    value: `r = ${r.toFixed(2)}`,
    context: `Across ${pairs.length} counties, ${period}. ${correlationStrength(r)} at the county level`,
  };
}

/** Speed and DUI: speeding crashes, alcohol-involved deaths and crashes, from
 *  the first alcohol-flag year to the last full year. */
export function speedEnforcementCallout(speedingYears: Rows, alcoholYears: Rows): CalloutFigure {
  const alcohol = closedYears(alcoholYears);
  need(alcohol.length >= 2, "alcohol years");
  const first = alcohol[0];
  const last = alcohol[alcohol.length - 1];
  const speeding = closedYears(speedingYears);
  const s0 = speeding.find((r) => r.year === first.year)?.crash_count;
  const s1 = speeding.find((r) => r.year === last.year)?.crash_count;
  need(s0 && s1, "speeding years");
  const prelim = isProvisionalDeathYear(last.year) ? ` (${last.year} deaths preliminary)` : "";

  return {
    label: `Speeding crashes, ${first.year} to ${last.year}`,
    value: signed(pctChange(s0, s1)),
    context:
      `From ${num(s0)} to ${num(s1)}. Deaths in alcohol-involved crashes ` +
      `${moved(pctChange(first.total_killed ?? 0, last.total_killed ?? 0))} over the same years${prelim}, ` +
      `while alcohol-involved crashes ${moved(pctChange(first.crash_count ?? 0, last.crash_count ?? 0))}`,
  };
}

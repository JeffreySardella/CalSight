/**
 * useCountyReport — everything the printable county report card renders.
 *
 * All of it comes from endpoints the app already calls:
 *   GET /api/stats?group_by=year&county=<slug>   county series, every year
 *   GET /api/stats?group_by=hour&county=<slug>   hour-of-day, 10-year window
 *   GET /api/stats?group_by=cause&county=<slug>  primary collision factors
 *   GET /api/stats?group_by=rate&year=a,b        all 58 counties, two years
 *   GET /api/licensed-drivers                    DMV denominator
 *   GET /api/road-miles                          Caltrans denominator
 *
 * Two stages: the year series decides which year is the latest COMPLETE one
 * (the in-progress calendar year is always short a few months and would read
 * as a collapse), and the other three queries are keyed on that year.
 *
 * The drivers and road-miles queries deliberately share useChoroplethData's
 * cache keys — same URL, same static payload, so a visitor arriving from the
 * map pays nothing for them.
 */

import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";
import { PERSISTED_QUERY_GC_TIME } from "../lib/queryPersistence";
import { slugify } from "./useFilterParams";
import { annualDriverCount } from "../lib/choropleth/measures";
import {
  buildMetrics,
  factorLabel,
  latestCompleteYear,
  rankOf,
  rate,
  CHANGE_LOOKBACK_YEARS,
  REPORT_WINDOW_YEARS,
  type MetricRow,
  type YearTotals,
} from "../lib/countyReport";

type YearRow = { year: number; crash_count: number; total_killed: number; total_injured: number };
type HourRow = { hour: number; crash_count: number };
type CauseRow = { canonical_cause: string; crash_count: number };
type RateRow = {
  county_code: number;
  county_name: string | null;
  year: number;
  total_crashes: number;
  total_killed: number;
  total_injured: number;
};
type DriverRow = { county_code: number; year: number; driver_count: number | null };
type RoadMileRow = { county_code: number; total_miles: number | null };

export type TrendPoint = { year: number; crashes: number; killed: number };
export type FactorItem = { label: string; count: number };

export type CountyReport = {
  countyName: string;
  countyCode: number | null;
  /** Latest complete year — the year every headline number describes. */
  year: number;
  /** The comparison year, five years earlier. */
  priorYear: number;
  /** First year of the trend / hour / factor window. */
  windowStart: number;
  metrics: MetricRow[];
  trend: TrendPoint[];
  hours: HourRow[];
  factors: FactorItem[];
  /** Where the county sits among the counties that have a deaths-per-1,000 rate. */
  rank: { rank: number; of: number } | null;
};

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error(`${path}: expected an array`);
  return body as T;
}

const EMPTY: YearTotals = { crashes: 0, killed: 0, injured: 0 };

function totals(rows: { total_crashes: number; total_killed: number; total_injured: number }[]): YearTotals {
  return rows.reduce<YearTotals>(
    (acc, r) => ({
      crashes: acc.crashes + r.total_crashes,
      killed: acc.killed + r.total_killed,
      injured: acc.injured + r.total_injured,
    }),
    EMPTY,
  );
}

/** Drivers for one year, with the nearest-year fill the map measures use —
 *  DMV publishes through 2024, so the latest complete crash year usually has
 *  no matching row of its own. */
function driversFor(rows: DriverRow[], year: number): number | null {
  return annualDriverCount(rows, new Set([year]));
}

export function useCountyReport(countyName: string | null) {
  const slug = countyName ? slugify(countyName) : null;

  const yearQuery = useQuery({
    queryKey: ["county-report", "year", slug],
    enabled: !!slug,
    staleTime: 60 * 60 * 1000,
    gcTime: PERSISTED_QUERY_GC_TIME,
    queryFn: () => getJson<YearRow[]>(`/api/stats?group_by=year&county=${slug}`),
  });

  const year = useMemo(
    () => latestCompleteYear((yearQuery.data ?? []).map((r) => r.year)),
    [yearQuery.data],
  );
  const priorYear = year != null ? year - CHANGE_LOOKBACK_YEARS : null;
  const windowStart = year != null ? year - (REPORT_WINDOW_YEARS - 1) : null;
  const ready = year != null && priorYear != null && windowStart != null;
  const windowQs = ready ? `start=${windowStart}-01&end=${year}-12` : "";

  const rest = useQueries({
    queries: [
      {
        queryKey: ["county-report", "hour", slug, year],
        enabled: ready && !!slug,
        staleTime: 60 * 60 * 1000,
        queryFn: () => getJson<HourRow[]>(`/api/stats?group_by=hour&county=${slug}&${windowQs}`),
      },
      {
        queryKey: ["county-report", "cause", slug, year],
        enabled: ready && !!slug,
        staleTime: 60 * 60 * 1000,
        queryFn: () => getJson<CauseRow[]>(`/api/stats?group_by=cause&county=${slug}&${windowQs}`),
      },
      {
        // Every county, both comparison years — the statewide column and the
        // 58-county ranking come out of this one response.
        queryKey: ["county-report", "rate", year],
        enabled: ready,
        staleTime: 60 * 60 * 1000,
        queryFn: () => getJson<RateRow[]>(`/api/stats?group_by=rate&year=${year},${priorYear}`),
      },
      {
        queryKey: ["choropleth", "licensedDrivers"],
        staleTime: Infinity,
        gcTime: PERSISTED_QUERY_GC_TIME,
        queryFn: () => getJson<DriverRow[]>("/api/licensed-drivers"),
      },
      {
        queryKey: ["choropleth", "roadMiles"],
        staleTime: Infinity,
        gcTime: PERSISTED_QUERY_GC_TIME,
        queryFn: () => getJson<RoadMileRow[]>("/api/road-miles"),
      },
    ],
  });

  const [hourQ, causeQ, rateQ, driversQ, milesQ] = rest;
  const all = [yearQuery, ...rest];

  const report = useMemo<CountyReport | null>(() => {
    if (!countyName || year == null || priorYear == null || windowStart == null) return null;
    const rateRows = rateQ.data;
    const yearRows = yearQuery.data;
    if (!rateRows || !yearRows) return null;

    const countyCode =
      rateRows.find((r) => r.county_name === countyName)?.county_code ?? null;

    const forYear = (y: number) => rateRows.filter((r) => r.year === y);
    const countyRows = (y: number) => forYear(y).filter((r) => r.county_code === countyCode);

    const driverRows = driversQ.data ?? [];
    const mileRows = milesQ.data ?? [];
    const countyDrivers = driverRows.filter((r) => r.county_code === countyCode);
    const countyMiles = mileRows
      .filter((r) => r.county_code === countyCode)
      .reduce((s, r) => s + (r.total_miles ?? 0), 0);
    const stateMiles = mileRows.reduce((s, r) => s + (r.total_miles ?? 0), 0);

    // Statewide driver totals are summed per county so each one gets its own
    // nearest-year fill, rather than dropping counties DMV hasn't published.
    const byCounty = new Map<number, DriverRow[]>();
    for (const r of driverRows) {
      const list = byCounty.get(r.county_code);
      if (list) list.push(r);
      else byCounty.set(r.county_code, [r]);
    }
    const stateDrivers = (y: number) => {
      let sum = 0;
      for (const rows of byCounty.values()) sum += driversFor(rows, y) ?? 0;
      return sum > 0 ? sum : null;
    };

    const metrics = buildMetrics({
      county: {
        now: totals(countyRows(year)),
        then: totals(countyRows(priorYear)),
        drivers: countyDrivers.length ? driversFor(countyDrivers, year) : null,
        priorDrivers: countyDrivers.length ? driversFor(countyDrivers, priorYear) : null,
        roadMiles: countyMiles > 0 ? countyMiles : null,
      },
      statewide: {
        now: totals(forYear(year)),
        then: totals(forYear(priorYear)),
        drivers: stateDrivers(year),
        priorDrivers: stateDrivers(priorYear),
        roadMiles: stateMiles > 0 ? stateMiles : null,
      },
    });

    // Rank on the same measure the table shows, with the same small-count floor.
    const perCounty = new Map<number, YearTotals>();
    for (const r of forYear(year)) {
      const prev = perCounty.get(r.county_code) ?? EMPTY;
      perCounty.set(r.county_code, {
        crashes: prev.crashes + r.total_crashes,
        killed: prev.killed + r.total_killed,
        injured: prev.injured + r.total_injured,
      });
    }
    const rank =
      countyCode == null
        ? null
        : rankOf(
            [...perCounty].map(([code, t]) => ({
              code,
              value: rate(t.crashes, t.killed, t.crashes, 1_000).value,
            })),
            countyCode,
          );

    const trend: TrendPoint[] = yearRows
      .filter((r) => r.year >= windowStart && r.year <= year)
      .sort((a, b) => a.year - b.year)
      .map((r) => ({ year: r.year, crashes: r.crash_count, killed: r.total_killed }));

    const factors: FactorItem[] = [...(causeQ.data ?? [])]
      .sort((a, b) => b.crash_count - a.crash_count)
      .slice(0, 5)
      .map((r) => ({ label: factorLabel(r.canonical_cause), count: r.crash_count }));

    const hours = [...(hourQ.data ?? [])].sort((a, b) => a.hour - b.hour);

    return {
      countyName,
      countyCode,
      year,
      priorYear,
      windowStart,
      metrics,
      trend,
      hours,
      factors,
      rank,
    };
  }, [countyName, year, priorYear, windowStart, yearQuery.data, rateQ.data, causeQ.data, hourQ.data, driversQ.data, milesQ.data]);

  // A county whose year series comes back empty has nothing to report on;
  // that is a dead end, not a load still in flight.
  const noData = yearQuery.isSuccess && year == null;
  const isError = all.some((q) => q.isError) || noData;

  return {
    report,
    isLoading: !isError && !!slug && (all.some((q) => q.isLoading) || report == null),
    isError,
    refetch: () => all.forEach((q) => void q.refetch()),
  };
}

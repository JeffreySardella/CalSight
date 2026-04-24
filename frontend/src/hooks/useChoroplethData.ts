import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  computeMeasureValue,
  type CountyStats,
  type CountyYearDemo,
  type MeasureKey,
  type MeasureResult,
} from "../lib/choropleth/measures";
import { CA_COUNTIES, YEARS, SEVERITIES, CAUSES } from "./useFilterParams";

export type ChoroplethFilters = {
  years: number[];           // parsed from URL; empty = no year filter
  severities: string[];      // backend values, e.g. "Fatal"
  causes: string[];          // URL slugs, e.g. ["dui", "lane-change"]
  // NOTE: alcohol / distracted are intentionally NOT here — /api/stats runs
  // against materialized views that don't carry is_alcohol_involved /
  // is_distraction_involved. Sending those params causes a 422. The URL
  // state (?alcohol=true / ?distracted=true) is preserved for future
  // /api/crashes drill-down endpoints.
  // `county` is intentionally omitted — the map always fetches stats for
  // ALL counties so the choropleth color scale stays globally consistent.
  // County filtering is applied visually in CountyBoundaries.computeStyle.
};

export type ChoroplethPoint = MeasureResult & {
  rawCount: number;
};

export type DataSummary = {
  totalCrashes: number;
  missingDemoYears: number[];
  partialDemoYears: number[];
  sparseYears: { year: number; count: number }[];
};

type YearStats = { year: number; crash_count: number; total_killed: number; total_injured: number };

const CURRENT_YEAR = new Date().getFullYear();

export type ChoroplethData = {
  byCountyCode: Record<number, ChoroplethPoint>;
  isLoading: boolean;
  isError: boolean;
  /** True when the backend returned 422 (bad filter value). The map retains
   *  the last-good choropleth via placeholderData; consumers can show an
   *  inline warning without blanking the map. */
  is422: boolean;
  error: Error | null;
  demographicsAvailable: boolean;
  dataSummary: DataSummary;
};

function normalizeFilters(filters: ChoroplethFilters): ChoroplethFilters {
  return {
    years: filters.years.length === YEARS.length ? [] : filters.years,
    severities: filters.severities.length === SEVERITIES.length ? [] : filters.severities,
    causes: filters.causes.length === CAUSES.length ? [] : filters.causes,
  };
}

function severityToSlug(s: string): string {
  return s.toLowerCase().replace(/ /g, "-");
}

function buildStatsUrl(filters: ChoroplethFilters): string {
  const p = new URLSearchParams();
  p.set("group_by", "county");
  if (filters.years.length) p.set("year", filters.years.join(","));
  if (filters.severities.length) p.set("severity", filters.severities.map(severityToSlug).join(","));
  if (filters.causes.length) p.set("cause", filters.causes.join(","));
  // alcohol / distracted are NOT forwarded — /api/stats rejects them (MVs
  // don't carry those columns). See stats.py lines 134-143.
  return `/api/stats?${p}`;
}

function buildYearStatsUrl(filters: ChoroplethFilters): string {
  const p = new URLSearchParams();
  p.set("group_by", "year");
  if (filters.years.length) p.set("year", filters.years.join(","));
  if (filters.severities.length) p.set("severity", filters.severities.map(severityToSlug).join(","));
  if (filters.causes.length) p.set("cause", filters.causes.join(","));
  return `/api/stats?${p}`;
}

function buildDemoUrl(filters: ChoroplethFilters): string {
  const p = new URLSearchParams();
  if (filters.years.length) p.set("year", filters.years.join(","));
  const qs = p.toString();
  return `/api/demographics${qs ? `?${qs}` : ""}`;
}

export function useChoroplethData(measure: MeasureKey, rawFilters: ChoroplethFilters): ChoroplethData {
  const filters = normalizeFilters(rawFilters);
  const queries = useQueries({
    queries: [
      {
        queryKey: ["choropleth", "stats", filters],
        placeholderData: (prev: CountyStats[] | undefined) => prev,
        queryFn: async (): Promise<CountyStats[]> => {
          const res = await fetch(buildStatsUrl(filters));
          if (!res.ok) {
            const err = new Error(`stats ${res.status}`);
            (err as Error & { status: number }).status = res.status;
            throw err;
          }
          return res.json();
        },
      },
      {
        queryKey: ["choropleth", "demographics", filters.years],
        placeholderData: (prev: CountyYearDemo[] | undefined) => prev,
        queryFn: async (): Promise<CountyYearDemo[]> => {
          const res = await fetch(buildDemoUrl(filters));
          if (!res.ok) throw new Error(`demographics ${res.status}`);
          return res.json();
        },
      },
      {
        queryKey: ["choropleth", "yearStats", filters],
        placeholderData: (prev: YearStats[] | undefined) => prev,
        queryFn: async (): Promise<YearStats[]> => {
          const res = await fetch(buildYearStatsUrl(filters));
          if (!res.ok) throw new Error(`yearStats ${res.status}`);
          return res.json();
        },
      },
    ],
  });

  const [statsQ, demoQ, yearStatsQ] = queries;
  const stats = statsQ.data;
  const demos = demoQ.data;
  const yearStats = yearStatsQ.data;

  const byCountyCode = useMemo<Record<number, ChoroplethPoint>>(() => {
    if (!stats) return {};
    const demoByCounty = new Map<number, CountyYearDemo[]>();
    for (const d of demos ?? []) {
      const arr = demoByCounty.get(d.county_code) ?? [];
      arr.push(d);
      demoByCounty.set(d.county_code, arr);
    }
    const out: Record<number, ChoroplethPoint> = {};
    for (const s of stats) {
      const result = computeMeasureValue(measure, s, demoByCounty.get(s.county_code) ?? []);
      out[s.county_code] = { ...result, rawCount: s.crash_count };
    }
    return out;
  }, [stats, demos, measure]);

  const dataSummary = useMemo<DataSummary>(() => {
    const totalCrashes = yearStats?.reduce((s, r) => s + r.crash_count, 0) ?? 0;

    const sparseYears: { year: number; count: number }[] = [];
    for (const r of yearStats ?? []) {
      if (r.year === CURRENT_YEAR) {
        sparseYears.push({ year: r.year, count: r.crash_count });
      }
    }

    if (filters.years.length === 0 || !demos) {
      return { totalCrashes, missingDemoYears: [], partialDemoYears: [], sparseYears };
    }

    const countiesByYear = new Map<number, number>();
    for (const d of demos) {
      if (d.population != null) {
        countiesByYear.set(d.year, (countiesByYear.get(d.year) ?? 0) + 1);
      }
    }
    const missingDemoYears: number[] = [];
    const partialDemoYears: number[] = [];
    for (const y of [...filters.years].sort((a, b) => a - b)) {
      const count = countiesByYear.get(y) ?? 0;
      if (count === 0) missingDemoYears.push(y);
      else if (count < CA_COUNTIES.length) partialDemoYears.push(y);
    }
    return { totalCrashes, missingDemoYears, partialDemoYears, sparseYears };
  }, [filters.years, demos, yearStats]);

  const rawError = (statsQ.error ?? demoQ.error ?? yearStatsQ.error) as (Error & { status?: number }) | null;

  return {
    byCountyCode,
    isLoading: statsQ.isLoading || demoQ.isLoading || yearStatsQ.isLoading,
    isError: statsQ.isError || demoQ.isError,
    is422: rawError?.status === 422,
    error: rawError,
    demographicsAvailable: !demoQ.isError && (demos?.length ?? 0) > 0,
    dataSummary,
  };
}

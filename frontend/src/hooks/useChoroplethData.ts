import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  computeMeasureValue,
  type CountyStats,
  type CountyYearDemo,
  type MeasureKey,
  type MeasureResult,
} from "../lib/choropleth/measures";

export type ChoroplethFilters = {
  years: number[];           // parsed from URL; empty = no year filter
  severities: string[];      // backend values, e.g. "Fatal"
  causes: string[];          // e.g. ["dui"]
  // `county` is intentionally omitted — the map always fetches stats for
  // ALL counties so the choropleth color scale stays globally consistent.
  // County filtering is applied visually in CountyBoundaries.computeStyle.
};

export type ChoroplethPoint = MeasureResult & {
  rawCount: number;
};

export type ChoroplethData = {
  byCountyCode: Record<number, ChoroplethPoint>;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  demographicsAvailable: boolean;
};

function severityToSlug(s: string): string {
  return s.toLowerCase().replace(/ /g, "-");
}

function buildStatsUrl(filters: ChoroplethFilters): string {
  const p = new URLSearchParams();
  p.set("group_by", "county");
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

export function useChoroplethData(measure: MeasureKey, filters: ChoroplethFilters): ChoroplethData {
  const queries = useQueries({
    queries: [
      {
        queryKey: ["choropleth", "stats", filters],
        queryFn: async (): Promise<CountyStats[]> => {
          const res = await fetch(buildStatsUrl(filters));
          if (!res.ok) throw new Error(`stats ${res.status}`);
          return res.json();
        },
      },
      {
        queryKey: ["choropleth", "demographics", filters.years],
        queryFn: async (): Promise<CountyYearDemo[]> => {
          const res = await fetch(buildDemoUrl(filters));
          if (!res.ok) throw new Error(`demographics ${res.status}`);
          return res.json();
        },
      },
    ],
  });

  const [statsQ, demoQ] = queries;
  const stats = statsQ.data;
  const demos = demoQ.data;

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

  return {
    byCountyCode,
    isLoading: statsQ.isLoading || demoQ.isLoading,
    isError: statsQ.isError || demoQ.isError,
    error: (statsQ.error ?? demoQ.error) as Error | null,
    demographicsAvailable: !demoQ.isError && (demos?.length ?? 0) > 0,
  };
}

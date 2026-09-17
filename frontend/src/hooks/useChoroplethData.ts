import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  annualDriverCount,
  computeMeasureValue,
  MEASURES,
  type DriverYear,
  type ContextValues,
  type CountyStats,
  type CountyYearDemo,
  type MeasureKey,
  type MeasureResult,
} from "../lib/choropleth/measures";
import type { CalEnviroScreenData, UnemploymentData } from "./useContextData";
import {
  CA_COUNTIES,
  SEVERITIES,
  CAUSES,
  formatYearMonth,
  yearsInRange,
  type DateRangeFilter,
} from "./useFilterParams";
import { API_BASE } from "../config";
import { PERSISTED_QUERY_GC_TIME } from "../lib/queryPersistence";

export type ChoroplethFilters = {
  dateRange: DateRangeFilter | null;
  severities: string[];
  causes: string[];
  alcohol?: boolean;
  distracted?: boolean;
  pedestrian?: boolean;
  cyclist?: boolean;
  drug?: boolean;
  driverAge?: string | null;
  weather?: string[];
  lighting?: string[];
  collisionType?: string[];
  roadType?: string | null;
  hitRun?: boolean;
};

export type ChoroplethPoint = MeasureResult & {
  rawCount: number;
  totalKilled: number;
  totalInjured: number;
};

export type DataSummary = {
  totalCrashes: number;
  missingDemoYears: number[];
  partialDemoYears: number[];
  /** Crash years with no census rows, filled from the nearest census year. */
  estimatedDemoYears: number[];
  /** The census years those estimates were taken from. */
  estimatedFromYears: number[];
  sparseYears: { year: number; count: number }[];
};

type YearStats = { year: number; crash_count: number; total_killed: number; total_injured: number };
type DriverRow = DriverYear & { county_code: number };
type RoadMileRow = { county_code: number; total_miles: number | null };

const CURRENT_YEAR = new Date().getFullYear();

export type ChoroplethData = {
  byCountyCode: Record<number, ChoroplethPoint>;
  nameToCode: Record<string, number>;
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
    dateRange: filters.dateRange,
    severities: filters.severities.length === SEVERITIES.length ? [] : filters.severities,
    causes: filters.causes.length === CAUSES.length ? [] : filters.causes,
    alcohol: filters.alcohol,
    distracted: filters.distracted,
    pedestrian: filters.pedestrian,
    cyclist: filters.cyclist,
    drug: filters.drug,
    driverAge: filters.driverAge,
    weather: filters.weather,
    lighting: filters.lighting,
    collisionType: filters.collisionType,
    roadType: filters.roadType,
    hitRun: filters.hitRun,
  };
}

function severityToSlug(s: string): string {
  return s.toLowerCase().replace(/ /g, "-");
}

function appendDateRange(p: URLSearchParams, dr: DateRangeFilter | null) {
  if (!dr) return;
  if (dr.start) p.set("start", formatYearMonth(dr.start));
  if (dr.end) p.set("end", formatYearMonth(dr.end));
}

function appendInvolvement(p: URLSearchParams, filters: ChoroplethFilters) {
  if (filters.alcohol) p.set("alcohol", "true");
  if (filters.distracted) p.set("distracted", "true");
  if (filters.pedestrian) p.set("pedestrian", "true");
  if (filters.cyclist) p.set("cyclist", "true");
  if (filters.drug) p.set("drug", "true");
  if (filters.driverAge) p.set("driver_age", filters.driverAge);
  if (filters.weather?.length) p.set("weather", filters.weather.join(","));
  if (filters.lighting?.length) p.set("lighting", filters.lighting.join(","));
  if (filters.collisionType?.length) p.set("collision_type", filters.collisionType.join(","));
  if (filters.roadType) p.set("road_type", filters.roadType);
  if (filters.hitRun) p.set("hit_run", "true");
}

function buildStatsUrl(filters: ChoroplethFilters): string {
  const p = new URLSearchParams();
  p.set("group_by", "county");
  appendDateRange(p, filters.dateRange);
  if (filters.severities.length) p.set("severity", filters.severities.map(severityToSlug).join(","));
  if (filters.causes.length) p.set("cause", filters.causes.join(","));
  appendInvolvement(p, filters);
  return `${API_BASE}/api/stats?${p}`;
}

function buildYearStatsUrl(filters: ChoroplethFilters): string {
  const p = new URLSearchParams();
  p.set("group_by", "year");
  appendDateRange(p, filters.dateRange);
  if (filters.severities.length) p.set("severity", filters.severities.map(severityToSlug).join(","));
  if (filters.causes.length) p.set("cause", filters.causes.join(","));
  appendInvolvement(p, filters);
  return `${API_BASE}/api/stats?${p}`;
}

function buildDemoUrl(filters: ChoroplethFilters): string {
  const p = new URLSearchParams();
  appendDateRange(p, filters.dateRange);
  // Years past the latest ACS release come back as the nearest year instead
  // of nothing, so per-capita maps for recent years aren't blank.
  if (filters.dateRange) p.set("nearest", "true");
  const qs = p.toString();
  return `${API_BASE}/api/demographics${qs ? `?${qs}` : ""}`;
}

/** Restrict demographics to `years`, filling any year without census rows
 *  from the nearest year that has them (later year on a tie). Returns the
 *  filled rows plus which years were estimated and from where. */
export function fillDemographicYears<T extends CountyYearDemo>(
  rows: T[],
  years: Set<number>,
): { rows: T[]; estimated: Map<number, number> } {
  const estimated = new Map<number, number>();
  const available = [...new Set(rows.filter((r) => r.population != null).map((r) => r.year))];
  if (years.size === 0 || available.length === 0) return { rows, estimated };
  const out = rows.filter((r) => years.has(r.year));
  for (const y of [...years].sort((a, b) => a - b)) {
    if (available.includes(y)) continue;
    const src = available.reduce((best, h) => {
      const d = Math.abs(h - y);
      const bd = Math.abs(best - y);
      return d < bd || (d === bd && h > best) ? h : best;
    });
    estimated.set(y, src);
    for (const r of rows) if (r.year === src) out.push({ ...r, year: y });
  }
  return { rows: out, estimated };
}

/** True when crashes matched but not one county could be colored. */
export function allCountiesNoData(byCountyCode: Record<number, MeasureResult>): boolean {
  const points = Object.values(byCountyCode);
  return points.length > 0 && points.every((pt) => !pt.hasEnoughData);
}

export function useChoroplethData(measure: MeasureKey, rawFilters: ChoroplethFilters): ChoroplethData {
  const filters = normalizeFilters(rawFilters);
  const dateKey = filters.dateRange
    ? `${filters.dateRange.start ? formatYearMonth(filters.dateRange.start) : ""}|${filters.dateRange.end ? formatYearMonth(filters.dateRange.end) : ""}`
    : "";
  const cacheKey = {
    d: dateKey, s: filters.severities, c: filters.causes,
    al: filters.alcohol, di: filters.distracted, pe: filters.pedestrian,
    cy: filters.cyclist, dr: filters.drug, da: filters.driverAge,
    we: filters.weather, li: filters.lighting, ct: filters.collisionType,
    rt: filters.roadType, hr: filters.hitRun,
  };

  // All five queries below are persisted offline (queryPersistence.ts
  // whitelist) — they carry PERSISTED_QUERY_GC_TIME so they outlive the short
  // global gcTime and keep feeding the snapshot.
  const queries = useQueries({
    queries: [
      {
        queryKey: ["choropleth", "stats", cacheKey],
        gcTime: PERSISTED_QUERY_GC_TIME,
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
        queryKey: ["choropleth", "demographics", dateKey],
        gcTime: PERSISTED_QUERY_GC_TIME,
        placeholderData: (prev: CountyYearDemo[] | undefined) => prev,
        queryFn: async (): Promise<CountyYearDemo[]> => {
          const res = await fetch(buildDemoUrl(filters));
          if (!res.ok) throw new Error(`demographics ${res.status}`);
          return res.json();
        },
      },
      {
        queryKey: ["choropleth", "yearStats", cacheKey],
        gcTime: PERSISTED_QUERY_GC_TIME,
        placeholderData: (prev: YearStats[] | undefined) => prev,
        queryFn: async (): Promise<YearStats[]> => {
          const res = await fetch(buildYearStatsUrl(filters));
          if (!res.ok) throw new Error(`yearStats ${res.status}`);
          return res.json();
        },
      },
      {
        queryKey: ["calenviroscreen"],
        staleTime: Infinity,
        gcTime: PERSISTED_QUERY_GC_TIME,
        enabled: MEASURES[measure]?.kind === "context" && measure !== "unemployment_rate",
        queryFn: async (): Promise<CalEnviroScreenData[]> => {
          const res = await fetch(`${API_BASE}/api/calenviroscreen`);
          if (!res.ok) throw new Error(`calenviroscreen ${res.status}`);
          return res.json();
        },
      },
      {
        queryKey: ["unemployment", dateKey],
        staleTime: 5 * 60 * 1000,
        gcTime: PERSISTED_QUERY_GC_TIME,
        enabled: measure === "unemployment_rate",
        queryFn: async (): Promise<UnemploymentData[]> => {
          const p = new URLSearchParams();
          appendDateRange(p, filters.dateRange);
          const qs = p.toString();
          const res = await fetch(`${API_BASE}/api/unemployment${qs ? `?${qs}` : ""}`);
          if (!res.ok) throw new Error(`unemployment ${res.status}`);
          return res.json();
        },
      },
      {
        // DMV licensed drivers per county-year (~1k rows, static between loads).
        queryKey: ["choropleth", "licensedDrivers"],
        staleTime: Infinity,
        gcTime: PERSISTED_QUERY_GC_TIME,
        enabled: MEASURES[measure]?.kind === "perDriver",
        queryFn: async (): Promise<DriverRow[]> => {
          const res = await fetch(`${API_BASE}/api/licensed-drivers`);
          if (!res.ok) throw new Error(`licensed-drivers ${res.status}`);
          return res.json();
        },
      },
      {
        // Caltrans road miles per county x functional class; summed below.
        queryKey: ["choropleth", "roadMiles"],
        staleTime: Infinity,
        gcTime: PERSISTED_QUERY_GC_TIME,
        enabled: MEASURES[measure]?.kind === "perRoadMile",
        queryFn: async (): Promise<RoadMileRow[]> => {
          const res = await fetch(`${API_BASE}/api/road-miles`);
          if (!res.ok) throw new Error(`road-miles ${res.status}`);
          return res.json();
        },
      },
    ],
  });

  const [statsQ, demoQ, yearStatsQ, cesQ, unempQ, driversQ, roadMilesQ] = queries;
  const stats = statsQ.data;
  const demos = demoQ.data;
  const yearStats = yearStatsQ.data;
  const cesData = cesQ.data as CalEnviroScreenData[] | undefined;
  const unempData = unempQ.data as UnemploymentData[] | undefined;
  const driverRows = driversQ.data as DriverRow[] | undefined;

  // Years the crash totals span: the date filter's years, else every year the
  // identically filtered year query returned. Population is filled for all of
  // them so per-capita values stay annual averages.
  const spanYears = useMemo(() => {
    const selected = yearsInRange(filters.dateRange);
    return selected.size > 0 ? selected : new Set((yearStats ?? []).map((r) => r.year));
  }, [filters.dateRange, yearStats]);
  const filledDemo = useMemo(() => fillDemographicYears(demos ?? [], spanYears), [demos, spanYears]);
  const roadMileRows = roadMilesQ.data as RoadMileRow[] | undefined;

  const { byCountyCode, nameToCode } = useMemo(() => {
    if (!stats) return { byCountyCode: {} as Record<number, ChoroplethPoint>, nameToCode: {} as Record<string, number> };
    const demoByCounty = new Map<number, CountyYearDemo[]>();
    for (const d of filledDemo.rows) {
      const arr = demoByCounty.get(d.county_code) ?? [];
      arr.push(d);
      demoByCounty.set(d.county_code, arr);
    }

    // Build context lookup maps for external datasets.
    const cesByCounty = new Map<number, CalEnviroScreenData>();
    for (const row of cesData ?? []) {
      cesByCounty.set(row.county_code, row);
    }

    // Average unemployment rate per county across available months.
    const unempByCounty = new Map<number, number>();
    if (unempData && unempData.length > 0) {
      const accum = new Map<number, { sum: number; count: number }>();
      for (const row of unempData) {
        if (row.unemployment_rate == null) continue;
        const prev = accum.get(row.county_code) ?? { sum: 0, count: 0 };
        prev.sum += row.unemployment_rate;
        prev.count += 1;
        accum.set(row.county_code, prev);
      }
      for (const [code, { sum, count }] of accum) {
        unempByCounty.set(code, sum / count);
      }
    }

    const driversByCounty = new Map<number, DriverRow[]>();
    for (const r of driverRows ?? []) {
      const arr = driversByCounty.get(r.county_code) ?? [];
      arr.push(r);
      driversByCounty.set(r.county_code, arr);
    }
    const milesByCounty = new Map<number, number>();
    for (const r of roadMileRows ?? []) {
      milesByCounty.set(r.county_code, (milesByCounty.get(r.county_code) ?? 0) + (r.total_miles ?? 0));
    }
    // Years the crash totals span: the date filter's years, else every year
    // the identically filtered year query returned.
    // ponytail: a partial current year counts as a full one, as in per-100k.
    const selectedYears = yearsInRange(filters.dateRange);
    const yearCount = selectedYears.size > 0 ? selectedYears.size : (yearStats?.length ?? 0);

    const out: Record<number, ChoroplethPoint> = {};
    const ntc: Record<string, number> = {};
    for (const s of stats) {
      // Build context values for this county.
      const ctx: ContextValues = {};
      const ces = cesByCounty.get(s.county_code);
      if (ces) {
        ctx.ces_score = ces.ces_score;
        ctx.pollution_burden = ces.pollution_burden;
        ctx.traffic_score = ces.traffic_score;
      }
      if (unempByCounty.has(s.county_code)) {
        ctx.unemployment_rate = unempByCounty.get(s.county_code)!;
      }

      const result = computeMeasureValue(measure, s, demoByCounty.get(s.county_code) ?? [], {
        context: ctx,
        annualDrivers: annualDriverCount(driversByCounty.get(s.county_code) ?? [], selectedYears),
        roadMiles: milesByCounty.get(s.county_code) ?? null,
        yearCount,
      });
      out[s.county_code] = { ...result, rawCount: s.crash_count, totalKilled: s.total_killed, totalInjured: s.total_injured };
      ntc[s.county_name] = s.county_code;
    }
    return { byCountyCode: out, nameToCode: ntc };
  }, [stats, filledDemo, measure, cesData, unempData, driverRows, roadMileRows, yearStats, filters.dateRange]);

  const dataSummary = useMemo<DataSummary>(() => {
    const totalCrashes = yearStats?.reduce((s, r) => s + r.crash_count, 0) ?? 0;

    const sparseYears: { year: number; count: number }[] = [];
    for (const r of yearStats ?? []) {
      if (r.year === CURRENT_YEAR) {
        sparseYears.push({ year: r.year, count: r.crash_count });
      }
    }

    const estimatedDemoYears = [...filledDemo.estimated.keys()].sort((a, b) => a - b);
    const estimatedFromYears = [...new Set(filledDemo.estimated.values())].sort((a, b) => a - b);

    const yearsForDisclaimer = [...yearsInRange(filters.dateRange)];
    if (yearsForDisclaimer.length === 0 || !demos) {
      return { totalCrashes, missingDemoYears: [], partialDemoYears: [], estimatedDemoYears, estimatedFromYears, sparseYears };
    }

    const countiesByYear = new Map<number, number>();
    for (const d of filledDemo.rows) {
      if (d.population != null) {
        countiesByYear.set(d.year, (countiesByYear.get(d.year) ?? 0) + 1);
      }
    }
    const missingDemoYears: number[] = [];
    const partialDemoYears: number[] = [];
    for (const y of yearsForDisclaimer.sort((a, b) => a - b)) {
      const count = countiesByYear.get(y) ?? 0;
      if (count === 0) missingDemoYears.push(y);
      else if (count < CA_COUNTIES.length) partialDemoYears.push(y);
    }
    return { totalCrashes, missingDemoYears, partialDemoYears, estimatedDemoYears, estimatedFromYears, sparseYears };
  }, [filters.dateRange, demos, filledDemo, yearStats]);

  const rawError = (statsQ.error ?? demoQ.error ?? yearStatsQ.error ?? cesQ.error ?? unempQ.error ?? driversQ.error ?? roadMilesQ.error) as (Error & { status?: number }) | null;

  return {
    byCountyCode,
    nameToCode,
    isLoading: statsQ.isLoading || demoQ.isLoading || yearStatsQ.isLoading || cesQ.isLoading || unempQ.isLoading || driversQ.isLoading || roadMilesQ.isLoading,
    isError: statsQ.isError || demoQ.isError || yearStatsQ.isError || cesQ.isError || unempQ.isError || driversQ.isError || roadMilesQ.isError,
    is422: rawError?.status === 422,
    error: rawError,
    demographicsAvailable: !demoQ.isError && (demos?.length ?? 0) > 0,
    dataSummary,
  };
}

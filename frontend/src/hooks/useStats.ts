import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { SEVERITIES, CAUSES, formatYearMonth, type DateRangeFilter } from "./useFilterParams";
import { API_BASE } from "../config";
import { PERSISTED_QUERY_GC_TIME } from "../lib/queryPersistence";

export type StatsFilters = {
  dateRange: DateRangeFilter | null;
  severities: string[];
  causes: string[];
  counties: string[];
  alcohol?: boolean;
  pedestrian?: boolean;
  cyclist?: boolean;
  drug?: boolean;
  distracted?: boolean;
  driverAge?: string | null;
  weather?: string | null;
  lighting?: string | null;
  collisionType?: string | null;
  roadType?: string | null;
  hitRun?: boolean;
};

export interface HourlyDataPoint { hour: number; count: number }
export interface YearlyDataPoint { year: number; count: number; killed: number; injured: number }
export interface CauseDataPoint { label: string; count: number }
export interface SeverityDataPoint { label: string; count: number }
export interface GenderDataPoint { label: string; count: number }
export interface AgeBracketDataPoint { label: string; count: number }
export interface AtFaultGenderDataPoint { label: string; count: number }
export interface AtFaultAgeBracketDataPoint { label: string; count: number }
export interface HeroMetrics {
  totalIncidents?: number;
  incidentYoYPct?: number;
  ksiRatePer100k?: number;
  yoyFatalityChangePct?: number;
}
export interface MonthlyDataPoint { month: number; label: string; count: number; killed: number; injured: number }
export interface DayOfWeekDataPoint { day: number; label: string; count: number }
export interface RateDataPoint {
  county_code: number; county_name: string; year: number; severity: string;
  total_crashes: number; total_killed: number; total_injured: number;
  per_100k_population: number | null; per_10k_licensed_drivers: number | null;
  per_100_road_miles: number | null; per_100k_aadt: number | null;
  per_10k_vehicles: number | null;
}

export interface StatsData {
  hourlyData: HourlyDataPoint[];
  yearlyData: YearlyDataPoint[];
  causesData: CauseDataPoint[];
  severityData: SeverityDataPoint[];
  genderData: GenderDataPoint[];
  ageBracketData: AgeBracketDataPoint[];
  atFaultGenderData: AtFaultGenderDataPoint[];
  atFaultAgeBracketData: AtFaultAgeBracketDataPoint[];
  monthlyData: MonthlyDataPoint[];
  dayOfWeekData: DayOfWeekDataPoint[];
  rateData: RateDataPoint[];
  heroMetrics: HeroMetrics;
}

export interface UseStatsResult {
  data: StatsData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

type YearRow = { year: number; crash_count: number; total_killed: number; total_injured: number };
type HourRow = { hour: number; crash_count: number };
type CauseRow = { canonical_cause: string; crash_count: number; total_killed: number; total_injured: number };
type SeverityRow = { severity: string; crash_count: number; total_killed: number; total_injured: number };
type GenderRow = { gender: string; victim_count: number; fatal_victim_count: number };
type AgeBracketRow = { age_bracket: string; victim_count: number; fatal_victim_count: number };
type AtFaultGenderRow = { gender: string; party_count: number; fatal_party_count: number };
type AtFaultAgeBracketRow = { age_bracket: string; party_count: number; fatal_party_count: number };
type DemoRow = { county_code: number; year: number; population: number | null };
type MonthRow = { month: number; crash_count: number; total_killed: number; total_injured: number };
type DayOfWeekRow = { day_of_week: number; crash_count: number };
type RateRow = {
  county_code: number; county_name: string | null; year: number; severity: string;
  total_crashes: number; total_killed: number; total_injured: number;
  per_100k_population: number | null; per_10k_licensed_drivers: number | null;
  per_100_road_miles: number | null; per_100k_aadt: number | null; per_10k_vehicles: number | null;
};

const CAUSE_LABEL: Record<string, string> = {
  dui: "DUI",
  speeding: "Speeding",
  lane_change: "Lane Change",
  right_of_way: "Right of Way",
  turning: "Improper Turn",
  following_too_close: "Tailgating",
  signal_violation: "Signal Violation",
  pedestrian_violation: "Pedestrian",
  unsafe_backing: "Unsafe Backing",
  other: "Other",
  uncategorized: "Uncategorized",
};

const AGE_LABEL: Record<string, string> = {
  under_18: "Under 18",
  "18_24": "18–24",
  "25_44": "25–44",
  "45_64": "45–64",
  over_65: "65+",
  unknown: "Unknown",
};

const AGE_ORDER = ["under_18", "18_24", "25_44", "45_64", "over_65", "unknown"];

const MONTH_LABEL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW_LABEL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function severityToSlug(s: string): string {
  return s.toLowerCase().replace(/ /g, "-");
}

function normalizeFilters(f: StatsFilters): StatsFilters {
  return {
    dateRange: f.dateRange,
    severities: f.severities.length === SEVERITIES.length ? [] : f.severities,
    causes: f.causes.length === CAUSES.length ? [] : f.causes,
    counties: f.counties,
    alcohol: f.alcohol,
    pedestrian: f.pedestrian,
    cyclist: f.cyclist,
    drug: f.drug,
    distracted: f.distracted,
    driverAge: f.driverAge,
    weather: f.weather,
    lighting: f.lighting,
    collisionType: f.collisionType,
    roadType: f.roadType,
    hitRun: f.hitRun,
  };
}

function buildDemoUrl(filters: StatsFilters): string {
  const p = new URLSearchParams();
  if (filters.dateRange) {
    if (filters.dateRange.start) p.set("start", formatYearMonth(filters.dateRange.start));
    if (filters.dateRange.end) p.set("end", formatYearMonth(filters.dateRange.end));
  }
  if (filters.counties.length) p.set("county", filters.counties.join(","));
  const qs = p.toString();
  return `${API_BASE}/api/demographics${qs ? `?${qs}` : ""}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`stats ${res.status}: ${body}`);
  }
  return res.json();
}

const CURRENT_YEAR = new Date().getFullYear();

function computeHeroMetrics(yearRows: YearRow[], population: number | null): HeroMetrics {
  if (!yearRows.length) return {};
  const totalIncidents = yearRows.reduce((s, r) => s + r.crash_count, 0);
  const totalKilled = yearRows.reduce((s, r) => s + r.total_killed, 0);
  const totalInjured = yearRows.reduce((s, r) => s + r.total_injured, 0);
  const complete = yearRows.filter((r) => r.year < CURRENT_YEAR).sort((a, b) => a.year - b.year);
  const hero: HeroMetrics = { totalIncidents };

  if (population && population > 0) {
    hero.ksiRatePer100k = Math.round(((totalKilled + totalInjured) / population) * 100_000 * 10) / 10;
  }

  if (complete.length >= 2) {
    const prev = complete[complete.length - 2];
    const curr = complete[complete.length - 1];
    if (prev.crash_count > 0) {
      hero.incidentYoYPct = Math.round(((curr.crash_count - prev.crash_count) / prev.crash_count) * 1000) / 10;
    }
    if (prev.total_killed > 0) {
      hero.yoyFatalityChangePct = Math.round(((curr.total_killed - prev.total_killed) / prev.total_killed) * 1000) / 10;
    }
  }
  return hero;
}

export function useStats(rawFilters: StatsFilters): UseStatsResult {
  const filters = normalizeFilters(rawFilters);
  // Stable cache key shape — DateRangeFilter is referentially stable thanks to
  // useFilterParams's memoization, but we serialize it for the query key so
  // structural equality checks behave predictably across renders.
  const dateKey = filters.dateRange
    ? `${filters.dateRange.start ? formatYearMonth(filters.dateRange.start) : ""}|${filters.dateRange.end ? formatYearMonth(filters.dateRange.end) : ""}`
    : "";
  const cacheKey = { d: dateKey, s: filters.severities, c: filters.causes, co: filters.counties, alc: filters.alcohol, ped: filters.pedestrian, cyc: filters.cyclist, drg: filters.drug, dis: filters.distracted, da: filters.driverAge, w: filters.weather, li: filters.lighting, ct: filters.collisionType, rt: filters.roadType, hr: filters.hitRun };

  const batchUrl = `${API_BASE}/api/stats/batch`;

  const batchBody = useMemo(() => {
    const b: Record<string, string> = {};
    if (filters.dateRange?.start) b.start = formatYearMonth(filters.dateRange.start);
    if (filters.dateRange?.end) b.end = formatYearMonth(filters.dateRange.end);
    if (filters.severities.length) b.severity = filters.severities.map(severityToSlug).join(",");
    if (filters.causes.length) b.cause = filters.causes.join(",");
    if (filters.counties.length) b.county = filters.counties.join(",");
    if (filters.alcohol) b.alcohol = "true";
    if (filters.pedestrian) b.pedestrian = "true";
    if (filters.cyclist) b.cyclist = "true";
    if (filters.drug) b.drug = "true";
    if (filters.distracted) b.distracted = "true";
    if (filters.driverAge) b.driver_age = filters.driverAge;
    if (filters.weather) b.weather = filters.weather;
    if (filters.lighting) b.lighting = filters.lighting;
    if (filters.collisionType) b.collision_type = filters.collisionType;
    if (filters.roadType) b.road_type = filters.roadType;
    if (filters.hitRun) b.hit_run = "true";
    return b;
  }, [filters]);

  const BATCH_GROUPS = [
    "year", "hour", "cause", "severity",
    "gender", "age_bracket", "at_fault_gender", "at_fault_age_bracket",
    "month", "day_of_week", "rate",
  ];

  type BatchResponse = Record<string, unknown[]>;

  const batchQuery = useQuery({
    queryKey: ["stats", "batch", cacheKey],
    queryFn: async (): Promise<BatchResponse> => {
      const res = await fetch(batchUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups: BATCH_GROUPS, ...batchBody }),
      });
      if (!res.ok) throw new Error(`stats batch ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
  });

  const demoQuery = useQuery({
    queryKey: ["stats", "demographics", { d: dateKey, co: filters.counties }],
    queryFn: () => fetchJson<DemoRow[]>(buildDemoUrl(filters)),
    staleTime: 60_000,
    // Persisted offline (queryPersistence.ts whitelist) — must outlive the
    // short global gcTime to keep feeding the snapshot. Note the heavy
    // stats/batch query above deliberately does NOT get this: it is excluded
    // from persistence and should be collected promptly.
    gcTime: PERSISTED_QUERY_GC_TIME,
  });

  const loading = batchQuery.isLoading;
  const rawError = batchQuery.error;

  const data = useMemo<StatsData | null>(() => {
    if (!batchQuery.data) return null;
    const b = batchQuery.data;

    /**
     * A batch group is only sometimes an array of rows.
     *
     * /api/stats/batch reports a per-group filter incompatibility *in band*,
     * inside an otherwise-200 response: `{"rate": {"error": "...", "filter":
     * "pedestrian"}}`. A `?? []` fallback can't catch that — the value is a
     * non-null object, so it passes through and `.map` throws during render,
     * taking the whole Stats page down to the ErrorBoundary. That is what any
     * involvement or condition filter used to do, including the promoted
     * "DUI Deep Dive" and "Crash Conditions" presets.
     *
     * Treat an incompatible group as "no data for these filters", which is
     * what it means, and let the panel render its normal empty state.
     */
    const rows = <T,>(group: unknown): T[] => (Array.isArray(group) ? (group as T[]) : []);

    const yearlyData: YearlyDataPoint[] = rows<YearRow>(b.year).map((r) => ({
      year: r.year, count: r.crash_count, killed: r.total_killed, injured: r.total_injured,
    }));
    const hourlyData: HourlyDataPoint[] = rows<HourRow>(b.hour).map((r) => ({
      hour: r.hour, count: r.crash_count,
    }));
    const causesData: CauseDataPoint[] = rows<CauseRow>(b.cause).map((r) => ({
      label: CAUSE_LABEL[r.canonical_cause] ?? r.canonical_cause, count: r.crash_count,
    }));
    const severityData: SeverityDataPoint[] = rows<SeverityRow>(b.severity).map((r) => ({
      label: r.severity, count: r.crash_count,
    }));
    const genderData: GenderDataPoint[] = rows<GenderRow>(b.gender)
      .filter((r) => r.gender && r.gender !== "unknown")
      .map((r) => ({ label: r.gender.charAt(0).toUpperCase() + r.gender.slice(1), count: r.victim_count }));
    const ageBracketData: AgeBracketDataPoint[] = rows<AgeBracketRow>(b.age_bracket)
      .sort((a, b2) => AGE_ORDER.indexOf(a.age_bracket) - AGE_ORDER.indexOf(b2.age_bracket))
      .filter((r) => r.age_bracket !== "unknown")
      .map((r) => ({ label: AGE_LABEL[r.age_bracket] ?? r.age_bracket, count: r.victim_count }));
    const atFaultGenderData: AtFaultGenderDataPoint[] = rows<AtFaultGenderRow>(b.at_fault_gender)
      .filter((r) => r.gender && r.gender !== "unknown")
      .map((r) => ({ label: r.gender.charAt(0).toUpperCase() + r.gender.slice(1), count: r.party_count }));
    const atFaultAgeBracketData: AtFaultAgeBracketDataPoint[] = rows<AtFaultAgeBracketRow>(b.at_fault_age_bracket)
      .sort((a, b2) => AGE_ORDER.indexOf(a.age_bracket) - AGE_ORDER.indexOf(b2.age_bracket))
      .filter((r) => r.age_bracket !== "unknown")
      .map((r) => ({ label: AGE_LABEL[r.age_bracket] ?? r.age_bracket, count: r.party_count }));
    const monthlyData: MonthlyDataPoint[] = rows<MonthRow>(b.month).map((r) => ({
      month: r.month, label: MONTH_LABEL[r.month - 1] ?? String(r.month),
      count: r.crash_count, killed: r.total_killed, injured: r.total_injured,
    }));
    const dayOfWeekData: DayOfWeekDataPoint[] = rows<DayOfWeekRow>(b.day_of_week).map((r) => ({
      day: r.day_of_week, label: DOW_LABEL[r.day_of_week] ?? String(r.day_of_week), count: r.crash_count,
    }));
    const rateData: RateDataPoint[] = rows<RateRow>(b.rate).map((r) => ({
      county_code: r.county_code, county_name: r.county_name ?? "Unknown", year: r.year,
      severity: r.severity, total_crashes: r.total_crashes, total_killed: r.total_killed,
      total_injured: r.total_injured, per_100k_population: r.per_100k_population,
      per_10k_licensed_drivers: r.per_10k_licensed_drivers, per_100_road_miles: r.per_100_road_miles,
      per_100k_aadt: r.per_100k_aadt, per_10k_vehicles: r.per_10k_vehicles,
    }));

    const population = demoQuery.data
      ? demoQuery.data.reduce((s, r) => s + (r.population ?? 0), 0)
      : null;
    const heroMetrics = computeHeroMetrics(rows<YearRow>(b.year), population);

    return { hourlyData, yearlyData, causesData, severityData, genderData, ageBracketData, atFaultGenderData, atFaultAgeBracketData, monthlyData, dayOfWeekData, rateData, heroMetrics };
  }, [batchQuery.data, demoQuery.data]);

  return {
    data,
    loading,
    error: rawError ? String(rawError) : null,
    refetch: () => { batchQuery.refetch(); demoQuery.refetch(); },
  };
}

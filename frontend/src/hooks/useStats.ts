import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { SEVERITIES, CAUSES, formatYearMonth, type DateRangeFilter } from "./useFilterParams";
import { API_BASE } from "../config";

export type StatsFilters = {
  dateRange: DateRangeFilter | null;
  severities: string[];
  causes: string[];
  counties: string[];
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
  };
}

function appendDateRange(p: URLSearchParams, dr: DateRangeFilter | null) {
  if (!dr) return;
  if (dr.start) p.set("start", formatYearMonth(dr.start));
  if (dr.end) p.set("end", formatYearMonth(dr.end));
}

function buildUrl(groupBy: string, filters: StatsFilters): string {
  const p = new URLSearchParams();
  p.set("group_by", groupBy);
  appendDateRange(p, filters.dateRange);
  if (filters.severities.length) p.set("severity", filters.severities.map(severityToSlug).join(","));
  if (filters.causes.length) p.set("cause", filters.causes.join(","));
  if (filters.counties.length) p.set("county", filters.counties.join(","));
  return `${API_BASE}/api/stats?${p}`;
}

function buildVictimUrl(groupBy: string, filters: StatsFilters): string {
  const p = new URLSearchParams();
  p.set("group_by", groupBy);
  appendDateRange(p, filters.dateRange);
  if (filters.severities.length) p.set("severity", filters.severities.map(severityToSlug).join(","));
  if (filters.counties.length) p.set("county", filters.counties.join(","));
  return `${API_BASE}/api/stats?${p}`;
}

function buildDemoUrl(filters: StatsFilters): string {
  const p = new URLSearchParams();
  appendDateRange(p, filters.dateRange);
  if (filters.counties.length) p.set("county", filters.counties.join(","));
  const qs = p.toString();
  return `${API_BASE}/api/demographics${qs ? `?${qs}` : ""}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`stats ${res.status}`);
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
  const cacheKey = { d: dateKey, s: filters.severities, c: filters.causes, co: filters.counties };

  const queries = useQueries({
    queries: [
      {
        queryKey: ["stats", "year", cacheKey],
        queryFn: () => fetchJson<YearRow[]>(buildUrl("year", filters)),
      },
      {
        queryKey: ["stats", "hour", cacheKey],
        queryFn: () => fetchJson<HourRow[]>(buildUrl("hour", filters)),
      },
      {
        queryKey: ["stats", "cause", cacheKey],
        queryFn: () => fetchJson<CauseRow[]>(buildUrl("cause", filters)),
      },
      {
        queryKey: ["stats", "demographics", { d: dateKey, co: filters.counties }],
        queryFn: () => fetchJson<DemoRow[]>(buildDemoUrl(filters)),
      },
      {
        queryKey: ["stats", "severity", cacheKey],
        queryFn: () => fetchJson<SeverityRow[]>(buildUrl("severity", filters)),
      },
      {
        queryKey: ["stats", "gender", { d: dateKey, s: filters.severities, co: filters.counties }],
        queryFn: () => fetchJson<GenderRow[]>(buildVictimUrl("gender", filters)),
      },
      {
        queryKey: ["stats", "age_bracket", { d: dateKey, s: filters.severities, co: filters.counties }],
        queryFn: () => fetchJson<AgeBracketRow[]>(buildVictimUrl("age_bracket", filters)),
      },
      {
        queryKey: ["stats", "at_fault_gender", { d: dateKey, s: filters.severities, co: filters.counties }],
        queryFn: () => fetchJson<AtFaultGenderRow[]>(buildVictimUrl("at_fault_gender", filters)),
      },
      {
        queryKey: ["stats", "at_fault_age_bracket", { d: dateKey, s: filters.severities, co: filters.counties }],
        queryFn: () => fetchJson<AtFaultAgeBracketRow[]>(buildVictimUrl("at_fault_age_bracket", filters)),
      },
      {
        queryKey: ["stats", "month", cacheKey],
        queryFn: () => fetchJson<MonthRow[]>(buildUrl("month", filters)),
      },
      {
        queryKey: ["stats", "day_of_week", cacheKey],
        queryFn: () => fetchJson<DayOfWeekRow[]>(buildUrl("day_of_week", filters)),
      },
      {
        queryKey: ["stats", "rate", { d: dateKey, co: filters.counties, s: filters.severities }],
        queryFn: () => fetchJson<RateRow[]>(buildUrl("rate", filters)),
      },
    ],
  });

  const [yearQ, hourQ, causeQ, demoQ, severityQ, genderQ, ageQ, atFaultGenderQ, atFaultAgeQ, monthQ, dowQ, rateQ] = queries;
  const loading = yearQ.isLoading || hourQ.isLoading || causeQ.isLoading;
  const rawError = yearQ.error ?? hourQ.error ?? causeQ.error;

  const data = useMemo<StatsData | null>(() => {
    if (!yearQ.data || !hourQ.data || !causeQ.data) return null;

    const yearlyData: YearlyDataPoint[] = yearQ.data.map((r) => ({
      year: r.year,
      count: r.crash_count,
      killed: r.total_killed,
      injured: r.total_injured,
    }));

    const hourlyData: HourlyDataPoint[] = hourQ.data.map((r) => ({
      hour: r.hour,
      count: r.crash_count,
    }));

    const causesData: CauseDataPoint[] = causeQ.data.map((r) => ({
      label: CAUSE_LABEL[r.canonical_cause] ?? r.canonical_cause,
      count: r.crash_count,
    }));

    const severityData: SeverityDataPoint[] = (severityQ.data ?? []).map((r) => ({
      label: r.severity,
      count: r.crash_count,
    }));

    const genderData: GenderDataPoint[] = (genderQ.data ?? [])
      .filter((r) => r.gender && r.gender !== "unknown")
      .map((r) => ({
        label: r.gender.charAt(0).toUpperCase() + r.gender.slice(1),
        count: r.victim_count,
      }));

    const ageBracketData: AgeBracketDataPoint[] = (ageQ.data ?? [])
      .sort((a, b) => AGE_ORDER.indexOf(a.age_bracket) - AGE_ORDER.indexOf(b.age_bracket))
      .filter((r) => r.age_bracket !== "unknown")
      .map((r) => ({
        label: AGE_LABEL[r.age_bracket] ?? r.age_bracket,
        count: r.victim_count,
      }));

    const atFaultGenderData: AtFaultGenderDataPoint[] = (atFaultGenderQ.data ?? [])
      .filter((r) => r.gender && r.gender !== "unknown")
      .map((r) => ({
        label: r.gender.charAt(0).toUpperCase() + r.gender.slice(1),
        count: r.party_count,
      }));

    const atFaultAgeBracketData: AtFaultAgeBracketDataPoint[] = (atFaultAgeQ.data ?? [])
      .sort((a, b) => AGE_ORDER.indexOf(a.age_bracket) - AGE_ORDER.indexOf(b.age_bracket))
      .filter((r) => r.age_bracket !== "unknown")
      .map((r) => ({
        label: AGE_LABEL[r.age_bracket] ?? r.age_bracket,
        count: r.party_count,
      }));

    const monthlyData: MonthlyDataPoint[] = (monthQ.data ?? []).map((r) => ({
      month: r.month,
      label: MONTH_LABEL[r.month - 1] ?? String(r.month),
      count: r.crash_count,
      killed: r.total_killed,
      injured: r.total_injured,
    }));

    const dayOfWeekData: DayOfWeekDataPoint[] = (dowQ.data ?? []).map((r) => ({
      day: r.day_of_week,
      label: DOW_LABEL[r.day_of_week] ?? String(r.day_of_week),
      count: r.crash_count,
    }));

    const rateData: RateDataPoint[] = (rateQ.data ?? []).map((r) => ({
      county_code: r.county_code,
      county_name: r.county_name ?? "Unknown",
      year: r.year,
      severity: r.severity,
      total_crashes: r.total_crashes,
      total_killed: r.total_killed,
      total_injured: r.total_injured,
      per_100k_population: r.per_100k_population,
      per_10k_licensed_drivers: r.per_10k_licensed_drivers,
      per_100_road_miles: r.per_100_road_miles,
      per_100k_aadt: r.per_100k_aadt,
      per_10k_vehicles: r.per_10k_vehicles,
    }));

    const population = demoQ.data
      ? demoQ.data.reduce((s, r) => s + (r.population ?? 0), 0)
      : null;
    const heroMetrics = computeHeroMetrics(yearQ.data, population);

    return { hourlyData, yearlyData, causesData, severityData, genderData, ageBracketData, atFaultGenderData, atFaultAgeBracketData, monthlyData, dayOfWeekData, rateData, heroMetrics };
  }, [yearQ.data, hourQ.data, causeQ.data, demoQ.data, severityQ.data, genderQ.data, ageQ.data, atFaultGenderQ.data, atFaultAgeQ.data, monthQ.data, dowQ.data, rateQ.data]);

  return {
    data,
    loading,
    error: rawError ? String(rawError) : null,
    refetch: () => queries.forEach((q) => q.refetch()),
  };
}

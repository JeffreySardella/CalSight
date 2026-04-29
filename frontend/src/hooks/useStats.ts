import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { YEARS, SEVERITIES, CAUSES } from "./useFilterParams";
import { API_BASE } from "../config";

export type StatsFilters = {
  years: number[];
  severities: string[];
  causes: string[];
  counties: string[];
};

export interface HourlyDataPoint { hour: number; count: number }
export interface YearlyDataPoint { year: number; count: number }
export interface CauseDataPoint { label: string; count: number }
export interface SeverityDataPoint { label: string; count: number }
export interface GenderDataPoint { label: string; count: number }
export interface AgeBracketDataPoint { label: string; count: number }
export interface HeroMetrics {
  totalIncidents?: number;
  incidentYoYPct?: number;
  ksiRatePer100k?: number;
  yoyFatalityChangePct?: number;
}

export interface StatsData {
  hourlyData: HourlyDataPoint[];
  yearlyData: YearlyDataPoint[];
  causesData: CauseDataPoint[];
  severityData: SeverityDataPoint[];
  genderData: GenderDataPoint[];
  ageBracketData: AgeBracketDataPoint[];
  heroMetrics: HeroMetrics;
}

export interface UseStatsResult {
  data: StatsData | null;
  loading: boolean;
  error: string | null;
}

type YearRow = { year: number; crash_count: number; total_killed: number; total_injured: number };
type HourRow = { hour: number; crash_count: number };
type CauseRow = { canonical_cause: string; crash_count: number; total_killed: number; total_injured: number };
type SeverityRow = { severity: string; crash_count: number; total_killed: number; total_injured: number };
type GenderRow = { gender: string; victim_count: number; fatal_victim_count: number };
type AgeBracketRow = { age_bracket: string; victim_count: number; fatal_victim_count: number };
type DemoRow = { county_code: number; year: number; population: number | null };

const CAUSE_LABEL: Record<string, string> = {
  dui: "DUI",
  speeding: "Speeding",
  lane_change: "Lane Change",
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

function severityToSlug(s: string): string {
  return s.toLowerCase().replace(/ /g, "-");
}

function normalizeFilters(f: StatsFilters): StatsFilters {
  return {
    years: f.years.length === YEARS.length ? [] : f.years,
    severities: f.severities.length === SEVERITIES.length ? [] : f.severities,
    causes: f.causes.length === CAUSES.length ? [] : f.causes,
    counties: f.counties,
  };
}

function buildUrl(groupBy: string, filters: StatsFilters): string {
  const p = new URLSearchParams();
  p.set("group_by", groupBy);
  if (filters.years.length) p.set("year", filters.years.join(","));
  if (filters.severities.length) p.set("severity", filters.severities.map(severityToSlug).join(","));
  if (filters.causes.length) p.set("cause", filters.causes.join(","));
  if (filters.counties.length) p.set("county", filters.counties.join(","));
  return `${API_BASE}/api/stats?${p}`;
}

function buildVictimUrl(groupBy: string, filters: StatsFilters): string {
  const p = new URLSearchParams();
  p.set("group_by", groupBy);
  if (filters.years.length) p.set("year", filters.years.join(","));
  if (filters.severities.length) p.set("severity", filters.severities.map(severityToSlug).join(","));
  if (filters.counties.length) p.set("county", filters.counties.join(","));
  return `${API_BASE}/api/stats?${p}`;
}

function buildDemoUrl(filters: StatsFilters): string {
  const p = new URLSearchParams();
  if (filters.years.length) p.set("year", filters.years.join(","));
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

  const demoFilters = { years: filters.years, counties: filters.counties };

  const queries = useQueries({
    queries: [
      {
        queryKey: ["stats", "year", filters],
        queryFn: () => fetchJson<YearRow[]>(buildUrl("year", filters)),
      },
      {
        queryKey: ["stats", "hour", filters],
        queryFn: () => fetchJson<HourRow[]>(buildUrl("hour", filters)),
      },
      {
        queryKey: ["stats", "cause", filters],
        queryFn: () => fetchJson<CauseRow[]>(buildUrl("cause", filters)),
      },
      {
        queryKey: ["stats", "demographics", demoFilters],
        queryFn: () => fetchJson<DemoRow[]>(buildDemoUrl(filters)),
      },
      {
        queryKey: ["stats", "severity", filters],
        queryFn: () => fetchJson<SeverityRow[]>(buildUrl("severity", filters)),
      },
      {
        queryKey: ["stats", "gender", { years: filters.years, severities: filters.severities, counties: filters.counties }],
        queryFn: () => fetchJson<GenderRow[]>(buildVictimUrl("gender", filters)),
      },
      {
        queryKey: ["stats", "age_bracket", { years: filters.years, severities: filters.severities, counties: filters.counties }],
        queryFn: () => fetchJson<AgeBracketRow[]>(buildVictimUrl("age_bracket", filters)),
      },
    ],
  });

  const [yearQ, hourQ, causeQ, demoQ, severityQ, genderQ, ageQ] = queries;
  const loading = yearQ.isLoading || hourQ.isLoading || causeQ.isLoading;
  const rawError = yearQ.error ?? hourQ.error ?? causeQ.error;

  const data = useMemo<StatsData | null>(() => {
    if (!yearQ.data || !hourQ.data || !causeQ.data) return null;

    const yearlyData: YearlyDataPoint[] = yearQ.data.map((r) => ({
      year: r.year,
      count: r.crash_count,
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

    const population = demoQ.data
      ? demoQ.data.reduce((s, r) => s + (r.population ?? 0), 0)
      : null;
    const heroMetrics = computeHeroMetrics(yearQ.data, population);

    return { hourlyData, yearlyData, causesData, severityData, genderData, ageBracketData, heroMetrics };
  }, [yearQ.data, hourQ.data, causeQ.data, demoQ.data, severityQ.data, genderQ.data, ageQ.data]);

  return {
    data,
    loading,
    error: rawError ? String(rawError) : null,
  };
}

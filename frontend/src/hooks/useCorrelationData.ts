import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";
import { formatYearMonth, type DateRangeFilter } from "./useFilterParams";
import type {
  CalEnviroScreenRow,
  CountyStatsRow,
  DemographicsRow,
  FarsRow,
  TractDensityRow,
  UnemploymentRow,
  VehiclesRow,
  WeatherRow,
} from "../types/api";

export type CorrelationFilters = {
  severity?: string[];
  alcohol?: boolean;
  pedestrian?: boolean;
  cyclist?: boolean;
  drug?: boolean;
  distracted?: boolean;
  dateRange?: DateRangeFilter | null;
};

export type CorrelationField = {
  key: string;
  label: string;
  source: string;
};

export const CORRELATION_FIELDS: CorrelationField[] = [
  { key: "crash_count", label: "Crashes", source: "stats" },
  { key: "total_killed", label: "Fatalities", source: "stats" },
  { key: "total_injured", label: "Injuries", source: "stats" },
  { key: "fatality_rate", label: "Fatality Rate", source: "derived" },
  { key: "poverty_rate", label: "Poverty %", source: "demographics" },
  { key: "median_income", label: "Income", source: "demographics" },
  { key: "population_density", label: "Density", source: "demographics" },
  { key: "pct_18_24", label: "Age 18-24", source: "demographics" },
  { key: "pct_65_plus", label: "Age 65+", source: "demographics" },
  { key: "pct_no_vehicle", label: "No Vehicle", source: "demographics" },
  { key: "commute_drive_alone_pct", label: "Drive Alone", source: "demographics" },
  { key: "commute_bike_pct", label: "Bike %", source: "demographics" },
  { key: "pct_with_disability", label: "Disability", source: "demographics" },
  { key: "unemployment_rate", label: "Unemploy.", source: "unemployment" },
  { key: "ces_score", label: "EnviroScr.", source: "calenviroscreen" },
  { key: "traffic_score", label: "Traffic", source: "calenviroscreen" },
  { key: "pollution_burden", label: "Pollution", source: "calenviroscreen" },
  { key: "diesel_pm_score", label: "Diesel PM", source: "calenviroscreen" },
  { key: "linguistic_isolation_pct", label: "Ling Isol.", source: "calenviroscreen" },
  { key: "housing_burden_pct", label: "Housing", source: "calenviroscreen" },
  { key: "education_pct", label: "No Diploma", source: "calenviroscreen" },
  { key: "ces_percentile", label: "CES %tile", source: "calenviroscreen" },
  { key: "ev_pct", label: "EV %", source: "vehicles" },
  { key: "vehicles_per_capita", label: "Vehicles/Cap", source: "derived" },
  { key: "avg_temp", label: "Avg Temp", source: "weather" },
  { key: "precip", label: "Rainfall", source: "weather" },
  { key: "fars_fatalities", label: "FARS Deaths", source: "fars" },
  { key: "pct_unrestrained", label: "Unrestrained %", source: "fars" },
  { key: "weighted_density", label: "Lived Density", source: "census" },
];

function pearsonR(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const xMean = xs.reduce((s, x) => s + x, 0) / n;
  const yMean = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xMean;
    const dy = ys[i] - yMean;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

export type CountyRow = Record<string, number | string | undefined>;

/**
 * Pure helper: merge FARS rows into byCounty.
 * Picks the most-recent year per county, then writes
 * `fars_fatalities` and (when guard passes) `pct_unrestrained`.
 * Mutates byCounty in place.
 */
export function applyFarsAggregation(
  fars: FarsRow[],
  byCounty: Record<string, CountyRow>,
): void {
  const farsByCounty: Record<string, FarsRow> = {};
  for (const r of fars) {
    const code = String(r.county_code ?? "");
    const existing = farsByCounty[code];
    if (!existing || (r.year ?? 0) > (existing.year ?? 0)) {
      farsByCounty[code] = r;
    }
  }
  for (const [code, r] of Object.entries(farsByCounty)) {
    if (!byCounty[code]) continue;
    if (r.fatalities != null) byCounty[code].fars_fatalities = r.fatalities;
    const unrestrained = r.unrestrained_killed;
    const known = r.restraint_known_killed;
    if (unrestrained != null && known != null && known > 0) {
      byCounty[code].pct_unrestrained = (unrestrained / known) * 100;
    }
  }
}

/**
 * Pure helper: merge tract density rows into byCounty.
 * Picks the most-recent year per county, then writes `weighted_density`.
 * Mutates byCounty in place.
 */
export function applyTractDensityAggregation(
  density: TractDensityRow[],
  byCounty: Record<string, CountyRow>,
): void {
  const latest: Record<string, TractDensityRow> = {};
  for (const r of density) {
    const code = String(r.county_code ?? "");
    const existing = latest[code];
    if (!existing || (r.year ?? 0) > (existing.year ?? 0)) {
      latest[code] = r;
    }
  }
  for (const [code, r] of Object.entries(latest)) {
    if (!byCounty[code]) continue;
    if (r.weighted_density != null) byCounty[code].weighted_density = r.weighted_density;
  }
}

/** Fetch a single endpoint, returning an empty array on failure. */
async function safeFetchJson<T>(url: string, init?: RequestInit): Promise<T[]> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) {
      console.warn(`[correlation] ${url} returned ${res.status} — skipping`);
      return [];
    }
    return (await res.json()) as T[];
  } catch (err) {
    console.warn(`[correlation] ${url} failed — skipping`, err);
    return [];
  }
}

/**
 * Supplemental (county-reference) datasets used by the correlation matrix.
 * NONE of these depend on the crash-level filters (date range, severity,
 * involvement flags) — they are static per-county reference tables. They are
 * therefore fetched under a filter-independent query key so that changing the
 * animated timelapse year (or any crash filter) does NOT refetch them.
 */
export type CorrelationSupplemental = {
  demographics: DemographicsRow[];
  calenviro: CalEnviroScreenRow[];
  unemployment: UnemploymentRow[];
  vehicles: VehiclesRow[];
  weather: WeatherRow[];
  fars: FarsRow[];
  density: TractDensityRow[];
};

/** Fetch all filter-independent supplemental sources in parallel. */
async function fetchCorrelationSupplemental(): Promise<CorrelationSupplemental> {
  const [demographics, calenviro, unemployment, vehicles, weather, fars, density] = await Promise.all([
    safeFetchJson<DemographicsRow>(`${API_BASE}/api/demographics`),
    safeFetchJson<CalEnviroScreenRow>(`${API_BASE}/api/calenviroscreen`),
    safeFetchJson<UnemploymentRow>(`${API_BASE}/api/unemployment`),
    safeFetchJson<VehiclesRow>(`${API_BASE}/api/vehicles`),
    safeFetchJson<WeatherRow>(`${API_BASE}/api/weather`),
    safeFetchJson<FarsRow>(`${API_BASE}/api/fars`),
    safeFetchJson<TractDensityRow>(`${API_BASE}/api/tract-density`),
  ]);
  return { demographics, calenviro, unemployment, vehicles, weather, fars, density };
}

export type CorrelationResult = {
  fields: CorrelationField[];
  matrix: number[][];
  countyCount: number;
  counties: CountyRow[];
};

/**
 * Pure builder: merge the (year-dependent) county crash stats with the
 * (filter-independent) supplemental datasets and compute the Pearson matrix.
 * Kept as a standalone function so the expensive 29×29 recompute only runs
 * when one of its inputs actually changes (see useMemo in useCorrelationData),
 * not on every unrelated re-render.
 */
export function buildCorrelationResult(
  countyStats: CountyStatsRow[],
  supplemental: CorrelationSupplemental,
): CorrelationResult {
  const { demographics, calenviro, unemployment, vehicles, weather, fars, density } = supplemental;

  const byCounty: Record<string, CountyRow> = {};

  for (const r of countyStats) {
    const code = String(r.county_code ?? "");
    if (!code) continue;
    byCounty[code] = {
      crash_count: r.crash_count ?? undefined,
      total_killed: r.total_killed ?? undefined,
      total_injured: r.total_injured ?? undefined,
    };
    const cc = r.crash_count ?? 0;
    const tk = r.total_killed ?? 0;
    byCounty[code].fatality_rate = cc > 0 ? (tk / cc) * 100 : 0;
  }

  const demoByCounty: Record<string, DemographicsRow> = {};
  for (const r of demographics) {
    const code = String(r.county_code ?? "");
    const existing = demoByCounty[code];
    if (!existing || (r.poverty_rate != null && (existing.poverty_rate == null || (r.year ?? 0) > (existing.year ?? 0)))) {
      demoByCounty[code] = r;
    }
  }
  for (const [code, r] of Object.entries(demoByCounty)) {
    if (!byCounty[code]) continue;
    byCounty[code].poverty_rate = r.poverty_rate ?? undefined;
    byCounty[code].median_income = r.median_income ?? undefined;
    byCounty[code].population_density = r.population_density ?? undefined;
    byCounty[code].pct_18_24 = r.pct_18_24 ?? undefined;
    byCounty[code].pct_65_plus = r.pct_65_plus ?? undefined;
    byCounty[code].commute_drive_alone_pct = r.commute_drive_alone_pct ?? undefined;
    byCounty[code].commute_bike_pct = r.commute_bike_pct ?? undefined;
    byCounty[code].pct_no_vehicle = r.pct_no_vehicle ?? undefined;
    byCounty[code].pct_with_disability = r.pct_with_disability ?? undefined;
  }

  for (const r of calenviro) {
    const code = String(r.county_code ?? "");
    if (!byCounty[code]) continue;
    byCounty[code].ces_score = r.ces_score ?? undefined;
    byCounty[code].traffic_score = r.traffic_score ?? undefined;
    byCounty[code].pollution_burden = r.pollution_burden ?? undefined;
    byCounty[code].diesel_pm_score = r.diesel_pm_score ?? undefined;
    byCounty[code].linguistic_isolation_pct = r.linguistic_isolation_pct ?? undefined;
    byCounty[code].housing_burden_pct = r.housing_burden_pct ?? undefined;
    byCounty[code].education_pct = r.education_pct ?? undefined;
    byCounty[code].ces_percentile = r.ces_percentile ?? undefined;
  }

  const latestUnemp: Record<string, number> = {};
  for (const r of unemployment) {
    const code = String(r.county_code ?? "");
    if (r.unemployment_rate != null) latestUnemp[code] = r.unemployment_rate;
  }
  for (const [code, rate] of Object.entries(latestUnemp)) {
    if (byCounty[code]) byCounty[code].unemployment_rate = rate;
  }

  // Vehicle data — pick the most recent year with non-null data per county
  const vehByCounty: Record<string, VehiclesRow> = {};
  for (const r of vehicles) {
    const code = String(r.county_code ?? "");
    const existing = vehByCounty[code];
    if (!existing || (r.total_vehicles != null && (existing.total_vehicles == null || (r.year ?? 0) > (existing.year ?? 0)))) {
      vehByCounty[code] = r;
    }
  }
  for (const [code, r] of Object.entries(vehByCounty)) {
    if (!byCounty[code]) continue;
    const total = r.total_vehicles;
    const ev = r.ev_vehicles;
    if (total != null && total > 0 && ev != null) {
      byCounty[code].ev_pct = (ev / total) * 100;
    }
    // vehicles_per_capita requires population from demographics
    const population = demoByCounty[code]?.population;
    if (total != null && population != null && population > 0) {
      byCounty[code].vehicles_per_capita = total / population;
    }
  }

  // Weather data — find most recent year per county, then average temp and sum precip
  const weatherByCountyYear: Record<string, Record<number, { temps: number[]; precips: number[] }>> = {};
  for (const r of weather) {
    const code = String(r.county_code ?? "");
    const year = r.year;
    if (!code || year == null) continue;
    if (!weatherByCountyYear[code]) weatherByCountyYear[code] = {};
    if (!weatherByCountyYear[code][year]) weatherByCountyYear[code][year] = { temps: [], precips: [] };
    if (r.avg_temp_f != null) weatherByCountyYear[code][year].temps.push(r.avg_temp_f);
    if (r.precipitation_in != null) weatherByCountyYear[code][year].precips.push(r.precipitation_in);
  }
  for (const [code, years] of Object.entries(weatherByCountyYear)) {
    if (!byCounty[code]) continue;
    const latestYear = Math.max(...Object.keys(years).map(Number));
    const data = years[latestYear];
    if (data.temps.length > 0) {
      byCounty[code].avg_temp = data.temps.reduce((s, v) => s + v, 0) / data.temps.length;
    }
    if (data.precips.length > 0) {
      byCounty[code].precip = data.precips.reduce((s, v) => s + v, 0);
    }
  }

  // FARS — most recent year per county; derive pct_unrestrained
  applyFarsAggregation(fars, byCounty);

  // Tract density — most recent year per county
  applyTractDensityAggregation(density, byCounty);

  const countyNames: Record<string, string> = {};
  for (const r of countyStats) {
    const code = String(r.county_code ?? "");
    const name = String(r.county_name ?? code);
    if (code) countyNames[code] = name;
  }

  const counties: CountyRow[] = Object.entries(byCounty)
    .filter(([, c]) => c.crash_count != null && Number(c.crash_count) > 0)
    .map(([code, c]) => {
      const row: CountyRow = { ...c, _name: countyNames[code] ?? code };
      return row;
    });

  const fields = CORRELATION_FIELDS;
  const matrix: number[][] = [];

  for (let i = 0; i < fields.length; i++) {
    matrix[i] = [];
    for (let j = 0; j < fields.length; j++) {
      if (i === j) { matrix[i][j] = 1; continue; }
      const xs: number[] = [];
      const ys: number[] = [];
      for (const c of counties) {
        const x = Number(c[fields[i].key]);
        const y = Number(c[fields[j].key]);
        if (!isNaN(x) && !isNaN(y) && isFinite(x) && isFinite(y)) {
          xs.push(x);
          ys.push(y);
        }
      }
      // NaN = not computable (source failed to load or too few counties
      // share both fields). Rendered as "—"; a fabricated 0 would read
      // as a real "no correlation" finding (M-F7).
      matrix[i][j] = xs.length >= 5 ? Math.round(pearsonR(xs, ys) * 100) / 100 : NaN;
    }
  }

  return { fields, matrix, countyCount: counties.length, counties };
}

export function useCorrelationData(filters?: CorrelationFilters) {
  // Build the batch body for crash stats — applies crash-level filters but never county
  const batchBody: Record<string, string> = {};
  if (filters?.dateRange?.start) batchBody.start = formatYearMonth(filters.dateRange.start);
  if (filters?.dateRange?.end) batchBody.end = formatYearMonth(filters.dateRange.end);
  if (filters?.severity?.length) batchBody.severity = filters.severity.map((s) => s.toLowerCase().replace(/ /g, "-")).join(",");
  if (filters?.alcohol) batchBody.alcohol = "true";
  if (filters?.pedestrian) batchBody.pedestrian = "true";
  if (filters?.cyclist) batchBody.cyclist = "true";
  if (filters?.drug) batchBody.drug = "true";
  if (filters?.distracted) batchBody.distracted = "true";

  // Stable cache key incorporating active filters (crash stats only)
  const filterKey = JSON.stringify(batchBody);

  // Filter-independent supplemental sources — fetched ONCE under a stable key.
  // The animated timelapse year changes filterKey (below) but never this key,
  // so these ~7 endpoints are not refetched on every tick.
  const supplemental = useQuery({
    queryKey: ["correlation-supplemental"],
    queryFn: fetchCorrelationSupplemental,
    staleTime: 30 * 60 * 1000,
  });

  // Year/filter-dependent county crash stats — re-keyed per filter change.
  const statsQuery = useQuery({
    queryKey: ["correlation-stats", filterKey],
    queryFn: async () => {
      // Only crash-level filters applied; county is omitted so we get all 58
      const statsRes = await fetch(`${API_BASE}/api/stats/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups: ["county"], ...batchBody }),
      });
      if (!statsRes.ok) {
        throw new Error("Failed to fetch crash stats for correlation matrix");
      }
      const stats = (await statsRes.json()) as { county?: CountyStatsRow[] };
      return stats.county ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Combine + compute the Pearson matrix only when an input actually changes.
  const data = useMemo<CorrelationResult | undefined>(() => {
    if (!statsQuery.data || !supplemental.data) return undefined;
    return buildCorrelationResult(statsQuery.data, supplemental.data);
  }, [statsQuery.data, supplemental.data]);

  return {
    data,
    isLoading: statsQuery.isLoading || supplemental.isLoading,
    error: statsQuery.error ?? supplemental.error ?? null,
  };
}

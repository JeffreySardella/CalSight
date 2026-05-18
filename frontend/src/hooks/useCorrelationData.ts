import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";
import { formatYearMonth, type DateRangeFilter } from "./useFilterParams";

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

/** Fetch a single endpoint, returning an empty array on failure. */
async function safeFetchJson<T = Record<string, unknown>[]>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) {
      console.warn(`[correlation] ${url} returned ${res.status} — skipping`);
      return [] as unknown as T;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[correlation] ${url} failed — skipping`, err);
    return [] as unknown as T;
  }
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

  // Stable cache key incorporating active filters
  const filterKey = JSON.stringify(batchBody);

  return useQuery({
    queryKey: ["correlation-matrix", filterKey],
    queryFn: async () => {
      // Stats is required — it provides the base county rows
      // Only crash-level filters applied; county is omitted so we get all 58
      const statsRes = await fetch(`${API_BASE}/api/stats/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups: ["county"], ...batchBody }),
      });
      if (!statsRes.ok) {
        throw new Error("Failed to fetch crash stats for correlation matrix");
      }
      const stats = await statsRes.json();

      // Supplemental sources — fetch in parallel, gracefully skip failures
      const [demographics, calenviro, unemployment, vehicles, weather] = await Promise.all([
        safeFetchJson<Record<string, unknown>[]>(`${API_BASE}/api/demographics`),
        safeFetchJson<Record<string, unknown>[]>(`${API_BASE}/api/calenviroscreen`),
        safeFetchJson<Record<string, unknown>[]>(`${API_BASE}/api/unemployment`),
        safeFetchJson<Record<string, unknown>[]>(`${API_BASE}/api/vehicles`),
        safeFetchJson<Record<string, unknown>[]>(`${API_BASE}/api/weather`),
      ]);

      const countyStats: Record<string, unknown>[] = stats.county ?? [];

      const byCounty: Record<string, CountyRow> = {};

      for (const r of countyStats) {
        const code = String((r as Record<string, unknown>).county_code ?? "");
        if (!code) continue;
        byCounty[code] = {
          crash_count: (r as Record<string, unknown>).crash_count as number,
          total_killed: (r as Record<string, unknown>).total_killed as number,
          total_injured: (r as Record<string, unknown>).total_injured as number,
        };
        const cc = (r as Record<string, unknown>).crash_count as number;
        const tk = (r as Record<string, unknown>).total_killed as number;
        byCounty[code].fatality_rate = cc > 0 ? (tk / cc) * 100 : 0;
      }

      const demoByCounty: Record<string, Record<string, unknown>> = {};
      for (const r of demographics) {
        const code = String(r.county_code ?? "");
        const existing = demoByCounty[code];
        if (!existing || (r.poverty_rate != null && (existing.poverty_rate == null || (r.year as number) > (existing.year as number)))) {
          demoByCounty[code] = r;
        }
      }
      for (const [code, r] of Object.entries(demoByCounty)) {
        if (!byCounty[code]) continue;
        byCounty[code].poverty_rate = r.poverty_rate as number;
        byCounty[code].median_income = r.median_income as number;
        byCounty[code].population_density = r.population_density as number;
        byCounty[code].pct_18_24 = r.pct_18_24 as number;
        byCounty[code].pct_65_plus = r.pct_65_plus as number;
        byCounty[code].commute_drive_alone_pct = r.commute_drive_alone_pct as number;
        byCounty[code].commute_bike_pct = r.commute_bike_pct as number;
        byCounty[code].pct_no_vehicle = r.pct_no_vehicle as number;
        byCounty[code].pct_with_disability = r.pct_with_disability as number;
      }

      for (const r of calenviro) {
        const code = String(r.county_code ?? "");
        if (!byCounty[code]) continue;
        byCounty[code].ces_score = r.ces_score as number;
        byCounty[code].traffic_score = r.traffic_score as number;
        byCounty[code].pollution_burden = r.pollution_burden as number;
        byCounty[code].diesel_pm_score = r.diesel_pm_score as number;
        byCounty[code].linguistic_isolation_pct = r.linguistic_isolation_pct as number;
        byCounty[code].housing_burden_pct = r.housing_burden_pct as number;
        byCounty[code].education_pct = r.education_pct as number;
        byCounty[code].ces_percentile = r.ces_percentile as number;
      }

      const latestUnemp: Record<string, number> = {};
      for (const r of unemployment) {
        const code = String(r.county_code ?? "");
        const rate = r.unemployment_rate as number;
        if (rate != null) latestUnemp[code] = rate;
      }
      for (const [code, rate] of Object.entries(latestUnemp)) {
        if (byCounty[code]) byCounty[code].unemployment_rate = rate;
      }

      // Vehicle data — pick the most recent year with non-null data per county
      const vehByCounty: Record<string, Record<string, unknown>> = {};
      for (const r of vehicles) {
        const code = String(r.county_code ?? "");
        const existing = vehByCounty[code];
        if (!existing || (r.total_vehicles != null && (existing.total_vehicles == null || (r.year as number) > (existing.year as number)))) {
          vehByCounty[code] = r;
        }
      }
      for (const [code, r] of Object.entries(vehByCounty)) {
        if (!byCounty[code]) continue;
        const total = r.total_vehicles as number;
        const ev = r.ev_vehicles as number;
        if (total != null && total > 0 && ev != null) {
          byCounty[code].ev_pct = (ev / total) * 100;
        }
        // vehicles_per_capita requires population from demographics
        const population = demoByCounty[code]?.population as number | undefined;
        if (total != null && population != null && population > 0) {
          byCounty[code].vehicles_per_capita = total / population;
        }
      }

      // Weather data — find most recent year per county, then average temp and sum precip
      const weatherByCountyYear: Record<string, Record<number, { temps: number[]; precips: number[] }>> = {};
      for (const r of weather) {
        const code = String(r.county_code ?? "");
        const year = r.year as number;
        const temp = r.avg_temp_f as number | null;
        const precip = r.precipitation_in as number | null;
        if (!code || year == null) continue;
        if (!weatherByCountyYear[code]) weatherByCountyYear[code] = {};
        if (!weatherByCountyYear[code][year]) weatherByCountyYear[code][year] = { temps: [], precips: [] };
        if (temp != null) weatherByCountyYear[code][year].temps.push(temp);
        if (precip != null) weatherByCountyYear[code][year].precips.push(precip);
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

      const countyNames: Record<string, string> = {};
      for (const r of countyStats) {
        const code = String((r as Record<string, unknown>).county_code ?? "");
        const name = String((r as Record<string, unknown>).county_name ?? code);
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
          matrix[i][j] = xs.length >= 5 ? Math.round(pearsonR(xs, ys) * 100) / 100 : 0;
        }
      }

      return { fields, matrix, countyCount: counties.length, counties };
    },
    staleTime: 5 * 60 * 1000,
  });
}

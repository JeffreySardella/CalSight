import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";

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

type CountyRow = Record<string, number | undefined>;

export function useCorrelationData() {
  return useQuery({
    queryKey: ["correlation-matrix"],
    queryFn: async () => {
      const [statsRes, demoRes, cesRes, unempRes] = await Promise.all([
        fetch(`${API_BASE}/api/stats/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groups: ["county"] }),
        }),
        fetch(`${API_BASE}/api/demographics`),
        fetch(`${API_BASE}/api/calenviroscreen`),
        fetch(`${API_BASE}/api/unemployment`),
      ]);

      if (!statsRes.ok || !demoRes.ok || !cesRes.ok || !unempRes.ok) {
        throw new Error("Failed to fetch correlation data");
      }

      const stats = await statsRes.json();
      const demographics: Record<string, unknown>[] = await demoRes.json();
      const calenviro: Record<string, unknown>[] = await cesRes.json();
      const unemployment: Record<string, unknown>[] = await unempRes.json();

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

      const counties = Object.values(byCounty).filter(
        (c) => c.crash_count != null && c.crash_count > 0,
      );

      const fields = CORRELATION_FIELDS;
      const matrix: number[][] = [];

      for (let i = 0; i < fields.length; i++) {
        matrix[i] = [];
        for (let j = 0; j < fields.length; j++) {
          if (i === j) { matrix[i][j] = 1; continue; }
          const xs: number[] = [];
          const ys: number[] = [];
          for (const c of counties) {
            const x = c[fields[i].key];
            const y = c[fields[j].key];
            if (x != null && y != null && isFinite(x) && isFinite(y)) {
              xs.push(x);
              ys.push(y);
            }
          }
          matrix[i][j] = xs.length >= 5 ? Math.round(pearsonR(xs, ys) * 100) / 100 : 0;
        }
      }

      return { fields, matrix, countyCount: counties.length };
    },
    staleTime: 5 * 60 * 1000,
  });
}

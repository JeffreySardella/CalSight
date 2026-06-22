import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";

export interface CalEnviroScreenData {
  county_code: number;
  ces_score: number | null;
  ces_percentile: number | null;
  pollution_burden: number | null;
  pop_characteristics: number | null;
  pm25_score: number | null;
  ozone_score: number | null;
  diesel_pm_score: number | null;
  pesticide_score: number | null;
  traffic_score: number | null;
  poverty_pct: number | null;
  unemployment_pct: number | null;
  education_pct: number | null;
  linguistic_isolation_pct: number | null;
  housing_burden_pct: number | null;
  tract_count: number | null;
}

export interface UnemploymentData {
  county_code: number;
  year: number;
  month: number;
  unemployment_rate: number | null;
}

export function useCalEnviroScreen() {
  return useQuery<CalEnviroScreenData[]>({
    queryKey: ["calenviroscreen"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/calenviroscreen`);
      if (!res.ok) throw new Error(`calenviroscreen ${res.status}`);
      return res.json();
    },
    staleTime: Infinity,
  });
}

export function useUnemployment(year?: number) {
  return useQuery<UnemploymentData[]>({
    queryKey: ["unemployment", year],
    queryFn: async () => {
      const params = year ? `?year=${year}` : "";
      const res = await fetch(`${API_BASE}/api/unemployment${params}`);
      if (!res.ok) throw new Error(`unemployment ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

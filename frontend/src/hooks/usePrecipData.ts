import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";

export interface PrecipIndex {
  station_id: string; // CDEC index id, e.g. "8SI"
  name: string;
  region: string;
  latest_date: string;
  accum_in: number; // accumulated water-year precipitation, inches
  avg_accum_in: number | null; // same-day-of-year average (null until history)
  pct_of_average: number | null;
}

export function usePrecipIndices() {
  return useQuery<PrecipIndex[] | null>({
    queryKey: ["water", "precip"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/water/precip`);
      // 404 = no precip-index data loaded yet — the section hides itself.
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`water/precip ${res.status}`);
      return res.json();
    },
    staleTime: 60 * 60 * 1000,
  });
}

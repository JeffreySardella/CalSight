import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";

export interface RegionSnowpack {
  region: string;
  station_count: number;
  latest_date: string;
  swe_in: number;
  avg_swe_in: number | null;
  pct_of_average: number | null;
  apr1_swe_in: number | null;
  apr1_avg_swe_in: number | null;
  apr1_pct_of_average: number | null;
}

export interface Snowpack {
  latest_date: string;
  statewide_pct_of_average: number | null;
  apr1_date: string | null;
  statewide_apr1_pct_of_average: number | null;
  regions: RegionSnowpack[];
}

export function useSnowpack() {
  return useQuery<Snowpack | null>({
    queryKey: ["water", "snowpack"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/water/snowpack`);
      // 404 = no snowpack data loaded yet — the section hides itself.
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`water/snowpack ${res.status}`);
      return res.json();
    },
    staleTime: 60 * 60 * 1000,
  });
}

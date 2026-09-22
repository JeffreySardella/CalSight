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
  baseline_period?: string | null;
}

export interface SnowStationCondition {
  station_id: string;
  name: string;
  region: string;
  elevation_ft: number | null;
  /** Station coordinates (CDEC staMeta). Null for rows loaded before the
   *  coordinate columns existed — the map layer skips those. */
  lat: number | null;
  lon: number | null;
  latest_date: string;
  swe_in: number;
  pct_of_average: number | null;
}

export interface Snowpack {
  latest_date: string;
  statewide_pct_of_average: number | null;
  apr1_date: string | null;
  statewide_apr1_pct_of_average: number | null;
  /** Normal period behind every percent-of-average, e.g. "1991-2020". */
  baseline_period?: string | null;
  regions: RegionSnowpack[];
  /** Per-station detail behind the regional means — the map layer's input.
   *  Optional: a cached payload from before the field shipped has none. */
  stations?: SnowStationCondition[];
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

import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";

/** One county-year (or roll-up): crashes on dense-fog-advisory days against
 *  every other day in the same calendar months. */
export interface FogYear {
  year: number;
  fog_event_days: number;
  crashes_on_fog_days: number;
  fog_day_avg_crashes: number;
  baseline_days: number;
  baseline_avg_crashes: number;
  /** null when the baseline is 0 — never rendered as a number. */
  lift_pct: number | null;
  fog_coded_crashes: number;
}

export interface FogCounty {
  county_code: number;
  county_name: string;
  county_slug: string;
  years: FogYear[];
}

export interface FogDays {
  county: string | null;
  year: number | null;
  fog_event_type: string;
  /** Calendar months the baseline is drawn from, 1-12. */
  months: number[];
  storm_events_through: number | null;
  totals: FogYear | null;
  /** Ascending by year. */
  years: FogYear[];
  counties: FogCounty[];
}

export function useFogDays(countySlug: string | null) {
  return useQuery<FogDays | null>({
    queryKey: ["fog-days", countySlug],
    queryFn: async () => {
      const qs = countySlug ? `?county=${encodeURIComponent(countySlug)}` : "";
      const res = await fetch(`${API_BASE}/api/fog-days${qs}`);
      // 404 = the endpoint/data isn't there yet — callers render nothing.
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`fog-days ${res.status}`);
      return res.json();
    },
    staleTime: 60 * 60 * 1000,
  });
}

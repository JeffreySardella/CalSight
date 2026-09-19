import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";

/** One county-year (or roll-up): crashes on dense-fog-advisory days against
 *  every other day in the same calendar months. */
export interface FogYear {
  /** null on the whole-period `totals` roll-up, which spans every year. */
  year: number | null;
  fog_event_days: number;
  crashes_on_fog_days: number;
  fog_day_avg_crashes: number;
  baseline_days: number;
  /** Raw off-fog count — pool this, never baseline_avg × baseline_days. */
  crashes_off_fog_days: number;
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
  /** Calendar months the baseline is drawn from, 1-12, ascending. */
  months: number[];
  storm_events_through: number | null;
  totals: FogYear | null;
  /** Ascending by year. */
  years: FogYear[];
  counties: FogCounty[];
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** [11, 12, 1, 2] -> "November, December, January and February", in calendar
 *  order as the API returns it. The chart must name the real comparison
 *  window rather than calling it "winter". */
export function formatMonths(months: number[]): string {
  const names = months.map((m) => MONTH_NAMES[m - 1]).filter(Boolean);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
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

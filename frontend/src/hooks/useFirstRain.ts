import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";

/** One statewide "first rainy day of the water year" event. */
export interface FirstRainStatewideEvent {
  water_year: number;
  counties: number;
  crashes_on_first_rain_days: number;
  baseline_expected: number;
  lift_pct: number;
  median_first_rain_date: string;
}

export interface FirstRainCountyEvent {
  county_code: number;
  county_name: string;
  county_slug: string;
  water_year: number;
  first_rain_date: string;
  precip_in: number;
  dry_days_before: number;
  crashes_on_day: number;
  baseline_daily_crashes: number;
  lift_pct: number;
  small_baseline: boolean;
}

export interface DaysSinceRain {
  county_code: number;
  county_name: string;
  county_slug: string;
  last_rain_date: string;
  days: number;
}

export interface FirstRain {
  threshold_in: number;
  min_dry_days: number;
  baseline_days: number;
  weather_through: string;
  statewide: {
    water_years: number;
    median_lift_pct: number;
    /** Ascending by water_year. */
    events: FirstRainStatewideEvent[];
  };
  counties: FirstRainCountyEvent[];
  days_since_rain: DaysSinceRain[];
}

export interface FirstRainSeriesPoint {
  date: string;
  crashes: number;
  precip_in: number;
  is_first_rain: boolean;
}

export interface FirstRainSeries {
  county_code: number;
  county_name: string;
  water_year: number;
  first_rain_date: string;
  /** 29 daily points, -14..+14 days around first_rain_date. */
  points: FirstRainSeriesPoint[];
}

/** "+31%" / "-4%" — lift is a signed percent, always shown with its sign. */
export function formatLift(pct: number): string {
  const n = Math.round(pct);
  return `${n > 0 ? "+" : ""}${n}%`;
}

/** "2024-11-04" → "Nov 4, 2024". The T00:00 suffix keeps a bare date from
 *  being parsed as UTC midnight and shifting a day in US timezones. */
export function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function useFirstRain() {
  return useQuery<FirstRain | null>({
    queryKey: ["first-rain"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/first-rain`);
      // 404 = the endpoint/data isn't there yet — callers render nothing.
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`first-rain ${res.status}`);
      return res.json();
    },
    staleTime: 60 * 60 * 1000,
  });
}

export function useFirstRainSeries(countySlug: string | null, waterYear: number | null) {
  return useQuery<FirstRainSeries | null>({
    queryKey: ["first-rain", "series", countySlug, waterYear],
    enabled: countySlug !== null && waterYear !== null,
    queryFn: async () => {
      const params = new URLSearchParams({
        county: countySlug as string,
        water_year: String(waterYear),
      });
      const res = await fetch(`${API_BASE}/api/first-rain/series?${params}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`first-rain/series ${res.status}`);
      return res.json();
    },
    staleTime: 60 * 60 * 1000,
  });
}

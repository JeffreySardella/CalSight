import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";

/** Counts and per-day rates over a set of calendar days. */
export interface HolidayRates {
  days: number;
  crashes: number;
  killed: number;
  dui_crashes: number;
  crashes_per_day: number;
  deaths_per_day: number;
  dui_share_pct: number;
}

export interface Holiday extends HolidayRates {
  key: string;
  label: string;
  /** Month name whose ordinary days form the baseline, e.g. "November". */
  baseline_month: string;
  baseline: HolidayRates;
  /** Null when the baseline rate is zero — undefined, not zero. */
  crashes_lift_pct: number | null;
  deaths_lift_pct: number | null;
  dui_share_lift_pct: number | null;
}

export interface Holidays {
  first_year: number;
  last_year: number;
  county_code: number | null;
  county_name: string | null;
  /** Empty while the matview is unpopulated — callers render nothing. */
  holidays: Holiday[];
}

/** "+31%" / "-4%" / "—" — lift is signed, and undefined stays undefined. */
export function formatLift(pct: number | null): string {
  if (pct === null) return "—";
  const n = Math.round(pct);
  return `${n > 0 ? "+" : ""}${n}%`;
}

/** 2.0 → "2.0", 0.04 → "0.04". Two significant-ish decimals for small rates. */
export function formatRate(n: number): string {
  return n >= 1 ? n.toFixed(1) : n.toFixed(2);
}

export function useHolidays(countySlug?: string | null) {
  return useQuery<Holidays | null>({
    queryKey: ["holidays", countySlug ?? null],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (countySlug) params.set("county", countySlug);
      const qs = params.toString();
      const res = await fetch(`${API_BASE}/api/holidays${qs ? `?${qs}` : ""}`);
      // 404 = the endpoint isn't deployed yet — callers render nothing.
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`holidays ${res.status}`);
      return res.json();
    },
    staleTime: 60 * 60 * 1000,
  });
}

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";
import { useCountyGeoJson } from "./useCountyGeoJson";

export interface DroughtPcts {
  none_pct: number;
  d0_pct: number;
  d1_pct: number;
  d2_pct: number;
  d3_pct: number;
  d4_pct: number;
}

export interface DroughtCounty extends DroughtPcts {
  county_code: number;
}

export interface DroughtSnapshot {
  week_start: string;
  statewide: DroughtPcts;
  counties: DroughtCounty[];
}

export function useDroughtSnapshot() {
  return useQuery<DroughtSnapshot | null>({
    queryKey: ["water", "drought"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/water/drought`);
      // 404 = no drought data loaded yet — the section simply hides.
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`water/drought ${res.status}`);
      return res.json();
    },
    staleTime: 60 * 60 * 1000,
  });
}

export interface DroughtWeekPoint extends DroughtPcts {
  week_start: string;
}

export function useDroughtSeries(weeks = 104, enabled = true) {
  return useQuery<DroughtWeekPoint[]>({
    queryKey: ["water", "drought-series", weeks],
    enabled,
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/api/water/drought/series?weeks=${weeks}`,
      );
      if (!res.ok) throw new Error(`water/drought/series ${res.status}`);
      return res.json();
    },
    staleTime: 60 * 60 * 1000,
  });
}

/** code → name, derived from the county topojson the drought map on the
 * same page already downloads — no extra API round-trip, and one source
 * of truth for names between the map tooltips and the hardest-hit list. */
export function useCountyNames() {
  const { data: geojson } = useCountyGeoJson();
  return useMemo(() => {
    if (!geojson) return undefined;
    return new Map<number, string>(
      geojson.features.map((f) => [
        Number(f.properties?.county_code),
        String(f.properties?.name ?? ""),
      ]),
    );
  }, [geojson]);
}

/** Percent of area in drought proper: D1 and worse (D0 is "abnormally
 *  dry", not yet drought — USDM's own convention). */
export function inDroughtPct(p: DroughtPcts): number {
  return p.d1_pct + p.d2_pct + p.d3_pct + p.d4_pct;
}

/** Severe-or-worse share used to rank the hardest-hit counties. */
export function severePct(p: DroughtPcts): number {
  return p.d2_pct + p.d3_pct + p.d4_pct;
}

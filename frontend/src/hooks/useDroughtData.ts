import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";

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

interface CountyRef {
  code: number;
  name: string;
}

export function useCountyNames() {
  return useQuery<Map<number, string>>({
    queryKey: ["counties", "names"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/counties?include_geojson=false`);
      if (!res.ok) throw new Error(`counties ${res.status}`);
      const rows: CountyRef[] = await res.json();
      return new Map(rows.map((r) => [r.code, r.name]));
    },
    staleTime: Infinity,
  });
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

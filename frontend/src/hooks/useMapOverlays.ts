import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";
import type { SchoolCrashCountsResponse } from "../lib/map/schoolCrashRamp";

export interface Hospital {
  facility_id: string;
  facility_name: string;
  facility_type: string | null;
  county_code: number;
  city: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  bed_capacity: number | null;
  trauma_center: string | null;
  trauma_pediatric: string | null;
  status: string | null;
}

export interface School {
  cds_code: string;
  school_name: string;
  county_code: number;
  city: string;
  latitude: number | null;
  longitude: number | null;
  school_type: string | null;
  status: string | null;
}

export function useHospitals(enabled: boolean) {
  return useQuery<Hospital[]>({
    queryKey: ["hospitals"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/hospitals`);
      if (!res.ok) throw new Error(`hospitals ${res.status}`);
      return res.json();
    },
    enabled,
    staleTime: Infinity,
  });
}

/**
 * Crashes within 500 ft of each school, for the marker ramp.
 *
 * Separate from useSchools because the school list itself never changes,
 * while these counts follow the map's year filter. Comes back with an empty
 * `schools` array while the matview is unpopulated (between a deploy and the
 * next nightly refresh), which the layer renders as "no data" gray.
 */
export function useSchoolCrashCounts(enabled: boolean, years: number[]) {
  const param = [...years].sort((a, b) => a - b).join(",");
  return useQuery<SchoolCrashCountsResponse>({
    queryKey: ["school-crash-counts", param],
    queryFn: async ({ signal }) => {
      const qs = param ? `?years=${param}` : "";
      const res = await fetch(`${API_BASE}/api/schools/crash-counts${qs}`, { signal });
      if (!res.ok) throw new Error(`school crash counts ${res.status}`);
      return res.json();
    },
    enabled,
    staleTime: Infinity,
  });
}

export function useSchools(enabled: boolean) {
  return useQuery<School[]>({
    queryKey: ["schools"],
    queryFn: async ({ signal }) => {
      const all: School[] = [];
      let offset = 0;
      const limit = 5000;
      const maxPages = 20;
      for (let page = 0; page < maxPages; page++) {
        const res = await fetch(`${API_BASE}/api/schools?limit=${limit}&offset=${offset}`, { signal });
        if (!res.ok) throw new Error(`schools ${res.status}`);
        const data = await res.json();
        const items = Array.isArray(data) ? data : data.items ?? [];
        all.push(...items);
        if (items.length < limit) break;
        offset += limit;
      }
      return all;
    },
    enabled,
    staleTime: Infinity,
  });
}

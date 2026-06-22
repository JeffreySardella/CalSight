import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";

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

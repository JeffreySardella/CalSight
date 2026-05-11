import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";

export interface Hospital {
  facility_id: string;
  facility_name: string;
  facility_type: string;
  county_code: number;
  city: string;
  latitude: number | null;
  longitude: number | null;
  trauma_center: string | null;
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
    queryFn: async () => {
      const all: School[] = [];
      let offset = 0;
      const limit = 5000;
      while (true) {
        const res = await fetch(`${API_BASE}/api/schools?limit=${limit}&offset=${offset}`);
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

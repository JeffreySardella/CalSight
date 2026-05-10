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
      const res = await fetch(`${API_BASE}/api/schools`);
      if (!res.ok) throw new Error(`schools ${res.status}`);
      return res.json();
    },
    enabled,
    staleTime: Infinity,
  });
}

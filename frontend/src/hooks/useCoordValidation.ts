import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";

export type CoordValidation = {
  total_with_coords: number;
  mismatched: number;
  valid: number;
  unchecked: number;
};

export function useCoordValidation(): CoordValidation | null {
  const { data } = useQuery<CoordValidation>({
    queryKey: ["coord-validation"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/meta/coord-validation`);
      if (!res.ok) throw new Error("coord-validation fetch failed");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  return data ?? null;
}

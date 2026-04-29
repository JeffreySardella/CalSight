import { useQuery } from "@tanstack/react-query";
import { YEARS } from "./useFilterParams";
import { API_BASE } from "../config";

type DataQualityRow = {
  county_code: number | null;
  year: number | null;
  total_crashes: number | null;
  crashes_with_coords: number | null;
};

export type CoordCoverage = {
  mapped: number;
  total: number;
  pct: number;
};

export function useCoordCoverage(selectedYears: number[]): CoordCoverage | null {
  const { data } = useQuery<DataQualityRow[]>({
    queryKey: ["data-quality-statewide"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/data-quality`);
      if (!res.ok) throw new Error("data-quality fetch failed");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (!data) return null;

  // Only statewide per-year rows (county_code null, year present)
  const statewide = data.filter((r) => r.county_code === null && r.year !== null);

  const allYears = selectedYears.length === 0 || selectedYears.length === YEARS.length;
  const yearSet = allYears ? null : new Set(selectedYears);
  const rows = yearSet ? statewide.filter((r) => yearSet.has(r.year!)) : statewide;

  if (!rows.length) return null;

  const mapped = rows.reduce((s, r) => s + (r.crashes_with_coords ?? 0), 0);
  const total = rows.reduce((s, r) => s + (r.total_crashes ?? 0), 0);

  if (total === 0) return null;
  return { mapped, total, pct: (mapped / total) * 100 };
}

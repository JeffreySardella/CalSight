import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";
import { slugify } from "./useFilterParams";

export interface RandomInsightCard {
  narrative: string;
  angle: string;
  year: number;
  county_name?: string;
  total_crashes?: number | null;
  total_killed?: number | null;
  total_injured?: number | null;
}

async function fetchRandom(
  countyName: string | null,
  year?: number,
): Promise<RandomInsightCard | null> {
  const url = countyName
    ? `${API_BASE}/api/insight-cards/random?county=${slugify(countyName)}${year ? `&year=${year}` : ""}`
    : `${API_BASE}/api/insights/statewide${year ? `?year=${year}` : ""}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`insight fetch failed: ${res.status}`);
  return res.json();
}

export function useRandomInsight(
  countyName: string | null | undefined,
  year?: number,
) {
  const [refreshKey, setRefreshKey] = useState(0);
  const name = countyName ?? null;

  const query = useQuery<RandomInsightCard | null>({
    queryKey: name
      ? ["random-insight", "county", name, year ?? null, refreshKey]
      : ["random-insight", "statewide", year ?? null, refreshKey],
    queryFn: () => fetchRandom(name, year),
    staleTime: Infinity,
  });

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return {
    card: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refresh,
  };
}

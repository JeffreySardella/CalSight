import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";
import { slugify } from "./useFilterParams";

export interface FunFact {
  narrative: string;
  year: number;
  angle: string;
  county_name: string | null;
}

async function fetchFunFacts(
  countyName: string | null,
  n: number,
): Promise<FunFact[]> {
  const params = new URLSearchParams({ n: String(n) });
  if (countyName) {
    params.set("county", slugify(countyName));
  }
  const res = await fetch(`${API_BASE}/api/fun-facts?${params}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`fun-facts fetch failed: ${res.status}`);
  return res.json();
}

export function useFunFacts(
  countyName: string | null | undefined,
  n = 5,
) {
  const name = countyName ?? null;

  const query = useQuery<FunFact[]>({
    queryKey: ["fun-facts", name, n],
    queryFn: () => fetchFunFacts(name, n),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  return {
    facts: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

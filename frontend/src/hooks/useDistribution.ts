import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";
import { adaptDistribution, type DistributionRow } from "../lib/ai/measureMetric";
import type { DistributionPoint } from "../lib/ai/statNarrative";

export function useDistribution(
  metric: string,
  year: number | null,
  options?: { enabled?: boolean },
): { data: DistributionPoint[] | undefined; isLoading: boolean } {
  const query = useQuery({
    queryKey: ["distribution", metric, year],
    enabled: options?.enabled ?? true,
    queryFn: async (): Promise<DistributionPoint[]> => {
      const params = new URLSearchParams({ metric });
      if (year != null) params.set("year", String(year));
      const res = await fetch(`${API_BASE}/api/stats/distribution?${params.toString()}`);
      if (!res.ok) throw new Error(`distribution ${res.status}`);
      const data = (await res.json()) as DistributionRow[];
      return adaptDistribution(data);
    },
  });
  return { data: query.data, isLoading: query.isLoading };
}

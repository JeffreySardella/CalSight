import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";

interface CauseCount {
  canonical_cause: string;
  crash_count: number;
}

interface SeverityCount {
  severity: string;
  crash_count: number;
}

export function useCauseCounts() {
  return useQuery<Record<string, number>>({
    queryKey: ["filter-counts", "cause"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/stats?group_by=cause`);
      if (!res.ok) return {};
      const data: CauseCount[] = await res.json();
      const map: Record<string, number> = {};
      for (const d of data) {
        map[d.canonical_cause] = d.crash_count;
      }
      return map;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useSeverityCounts() {
  return useQuery<Record<string, number>>({
    queryKey: ["filter-counts", "severity"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/stats?group_by=severity`);
      if (!res.ok) return {};
      const data: SeverityCount[] = await res.json();
      const map: Record<string, number> = {};
      for (const d of data) {
        map[d.severity] = d.crash_count;
      }
      return map;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString();
}

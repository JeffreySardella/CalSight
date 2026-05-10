import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";

export function usePrefetchFacets() {
  useQuery({
    queryKey: ["prefetch-facets", "year"],
    queryFn: () => fetch(`${API_BASE}/api/stats?group_by=year`).then((r) => r.json()),
    staleTime: 10 * 60 * 1000,
  });
  useQuery({
    queryKey: ["prefetch-facets", "severity"],
    queryFn: () => fetch(`${API_BASE}/api/stats?group_by=severity`).then((r) => r.json()),
    staleTime: 10 * 60 * 1000,
  });
  useQuery({
    queryKey: ["prefetch-facets", "cause"],
    queryFn: () => fetch(`${API_BASE}/api/stats?group_by=cause`).then((r) => r.json()),
    staleTime: 10 * 60 * 1000,
  });
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "../config";

interface SourceFreshness {
  source: string;
  last_loaded_at: string;
}

interface DataFreshnessResult {
  lastUpdatedAt: Date | null;
  isStale: boolean;
  relativeTime: string;
  isLoading: boolean;
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "1 day ago";
  return `${diffDays} days ago`;
}

export function useDataFreshness(): DataFreshnessResult {
  const { data, isLoading } = useQuery<SourceFreshness[]>({
    queryKey: ["data-freshness"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/meta/data-freshness`);
      if (!res.ok) throw new Error(`data-freshness ${res.status}`);
      const json = await res.json();
      if (Array.isArray(json)) return json;
      return Object.entries(json).map(([source, v]: [string, any]) => ({
        source,
        last_loaded_at: v.last_loaded_at,
      }));
    },
    refetchInterval: 5 * 60 * 1000,
  });

  if (!data || !Array.isArray(data) || data.length === 0) {
    return { lastUpdatedAt: null, isStale: false, relativeTime: "", isLoading };
  }

  const timestamps = data
    .map((s) => new Date(s.last_loaded_at).getTime())
    .filter((t) => !isNaN(t));

  if (timestamps.length === 0) {
    return { lastUpdatedAt: null, isStale: false, relativeTime: "", isLoading };
  }

  const mostRecent = new Date(Math.max(...timestamps));
  const diffMs = Date.now() - mostRecent.getTime();
  const isStale = diffMs > 24 * 60 * 60 * 1000;
  const relativeTime = formatRelativeTime(mostRecent);

  return { lastUpdatedAt: mostRecent, isStale, relativeTime, isLoading };
}

export function useInvalidateAllDashboard() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["stats"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["correlation-matrix"] });
  };
}

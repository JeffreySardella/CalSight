import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";

export type ApiHealth = "ok" | "maintenance" | "down";

/**
 * Polls /api/health so the app can show a maintenance screen when the API is
 * either deliberately offline (MAINTENANCE_MODE → 503 {status:"maintenance"})
 * or unreachable during a server migration (the whole box is down → fetch
 * throws). The ['health'] key is excluded by the persistence whitelist, so it
 * is never cached and can't flash a stale state on reload.
 */
export function useApiHealth(): ApiHealth {
  const query = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/health`);
      if (res.status === 503) {
        const body = (await res.json().catch(() => null)) as { status?: string } | null;
        if (body?.status === "maintenance") return "maintenance" as const;
        throw new Error("api-unhealthy");
      }
      if (!res.ok) throw new Error("api-unhealthy");
      return "ok" as const;
    },
    // Poll often while unhealthy so recovery is detected quickly; back off when ok.
    refetchInterval: (q) =>
      q.state.data === "maintenance" || q.state.fetchFailureCount > 0 ? 10_000 : 45_000,
    refetchOnWindowFocus: true,
    retry: 2,
    retryDelay: 2_000,
    staleTime: 0,
    gcTime: 0,
  });

  if (query.data === "maintenance") return "maintenance";
  // Only declare "down" after a full failed retry cycle (1 attempt + 2 retries),
  // so a single dropped request on flaky wifi doesn't flash the screen.
  if (query.failureCount >= 3) return "down";
  return "ok";
}

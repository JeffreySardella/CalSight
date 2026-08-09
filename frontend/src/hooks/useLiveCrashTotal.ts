import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";

/**
 * The total crash count, read from the API rather than baked into the bundle.
 *
 * Several public surfaces hard-coded this figure and quietly drifted behind
 * the database as the nightly ETL loaded more — the intro overlay animated to
 * 11,129,647 and the About page said "11.1M" while the API had already passed
 * 11.34M. On a project whose whole pitch is transparency, the headline number
 * being stale is the most expensive kind of small bug.
 *
 * `FALLBACK_TOTAL` is a floor, not a claim: it renders only until the request
 * resolves (and if the API is unreachable), so the figure is never zero and
 * never higher than reality.
 */
const FALLBACK_TOTAL = 11_300_000;

export function useLiveCrashTotal(): number {
  const { data } = useQuery({
    queryKey: ["live-crash-total"],
    queryFn: async (): Promise<{ total_crashes: number }> => {
      const res = await fetch(`${API_BASE}/api/stats`);
      if (!res.ok) throw new Error(`stats ${res.status}`);
      return res.json();
    },
    // The count changes once a night; there is no reason to refetch on mount.
    staleTime: 60 * 60 * 1000,
  });

  return data?.total_crashes ?? FALLBACK_TOTAL;
}

import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import type { Query } from "@tanstack/react-query";

// Bump when a persisted query's response shape changes — a mismatched bundle
// would otherwise hydrate an incompatible cached shape on the next load.
export const PERSIST_BUSTER = "v1";

// 24h. Crash aggregates change at most daily (ETL cadence). Kept equal to gcTime
// in queryClient.ts so a query stays in-cache long enough to reach this age.
export const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000;

// Query-key roots safe to persist offline — small county-aggregate payloads from
// useCountyInsight / useStats / useChoroplethData / useDataQualityDisclaimer.
const PERSIST_WHITELIST = new Set([
  "insight",
  "stats",
  "choropleth",
  "calenviroscreen",
  "unemployment",
  "data-quality",
]);

// Whitelist-by-default: only known county-aggregate queries are persisted, so a
// future large query type can't silently blow the localStorage quota. The raw
// crash-heatmap payload (multi-MB) is also excluded explicitly.
export function shouldDehydrateQuery(query: Query): boolean {
  if (query.state.status !== "success" || query.state.data === undefined) {
    return false;
  }
  const root = query.queryKey[0];
  if (typeof root !== "string" || root === "crashHeatmap") {
    return false;
  }
  return PERSIST_WHITELIST.has(root);
}

export const persister = createSyncStoragePersister({
  storage: typeof window !== "undefined" ? window.localStorage : undefined,
  key: "calsight-query-cache",
  throttleTime: 1000,
});

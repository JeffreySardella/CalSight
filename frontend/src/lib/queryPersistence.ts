import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { removeOldestQuery } from "@tanstack/react-query-persist-client";
import type { Query } from "@tanstack/react-query";

// Bump when a persisted query's response shape changes — a mismatched bundle
// would otherwise hydrate an incompatible cached shape on the next load.
export const PERSIST_BUSTER = "v1";

// 24h. Crash aggregates change at most daily (ETL cadence).
export const PERSIST_MAX_AGE = 24 * 60 * 60 * 1000;

// Per-query gcTime for the persisted county-aggregate queries. A query must
// stay in the in-memory cache to keep being written to the persisted snapshot,
// so persisted queries opt into a gcTime equal to PERSIST_MAX_AGE while the
// global default in queryClient.ts stays short (heavy map payloads would
// otherwise be retained for hours with no persistence benefit).
export const PERSISTED_QUERY_GC_TIME = PERSIST_MAX_AGE;

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
  // stats/batch payloads are hundreds of KB each and timelapse multiplies the
  // filter permutations — persisting them bloats the snapshot (a multi-MB
  // synchronous JSON.stringify per write) and risks the localStorage quota.
  // Other stats queries (e.g. stats/demographics) remain persisted.
  if (root === "stats" && query.queryKey[1] === "batch") {
    return false;
  }
  return PERSIST_WHITELIST.has(root);
}

function getStorage(): Storage | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    window.localStorage.getItem("__test__");
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export const persister = createSyncStoragePersister({
  storage: getStorage(),
  key: "calsight-query-cache",
  throttleTime: 1000,
  // On QuotaExceededError, drop the oldest persisted queries and retry instead
  // of silently giving up on persistence for the rest of the session.
  retry: removeOldestQuery,
});

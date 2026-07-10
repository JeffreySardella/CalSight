import { QueryClient } from "@tanstack/react-query";

// Max attempts AFTER the initial request (so up to 4 total tries). Chosen to
// ride out the couple-of-seconds dropouts you get on flaky cellular / wifi
// handoffs without hammering the server when it's genuinely down.
export const MAX_QUERY_RETRIES = 3;

/**
 * Pulls a trailing HTTP status out of our fetch errors. The data hooks throw
 * `new Error("heatmap 503")` / `new Error("dashboard batch 500")`, so the code
 * is the last 3-digit token in the message. Returns null when there's no
 * recognizable status — a network drop, a timeout (AbortSignal.timeout throws a
 * TimeoutError with no code), or an aborted request — which we treat as
 * transient and therefore retryable.
 */
export function statusFromError(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const match = error.message.match(/\b(\d{3})\b/);
  if (!match) return null;
  const code = Number(match[1]);
  return code >= 100 && code < 600 ? code : null;
}

/**
 * A 4xx won't succeed by trying again (bad filter, not found, unauthorized) —
 * retrying just delays the error state the user needs to see. Only retry the
 * things that plausibly recover on their own: network errors, timeouts, 5xx
 * server hiccups, and 429 rate limits (transient by definition — the bucket
 * refills; the existing exponential backoff spaces the attempts out, since
 * Retry-After isn't recoverable from our string-message errors). Anything
 * without a status is usually a dropped connection, also retryable.
 */
export function isRetryableError(error: unknown): boolean {
  const status = statusFromError(error);
  if (status == null) return true;
  return status === 429 || status >= 500;
}

export function shouldRetry(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_QUERY_RETRIES && isRetryableError(error);
}

/**
 * Exponential backoff with a little jitter, capped at 15s. Spacing the retries
 * out (~1s, ~2s, ~4s) gives a flaky signal time to actually come back and
 * avoids a thundering-herd retry storm when the API is briefly overloaded.
 * attemptIndex is 0-based for the first retry.
 */
export function retryBackoff(attemptIndex: number): number {
  const base = Math.min(1000 * 2 ** attemptIndex, 15_000);
  return base + Math.random() * 250;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      // Modest default (the TanStack default): heavy map payloads (crashHeatmap
      // batches, crashClusters) must not linger for hours after unmount. The
      // small persisted county-aggregate queries opt into a 24h gcTime
      // individually via PERSISTED_QUERY_GC_TIME (queryPersistence.ts) so they
      // stay in-cache long enough to keep feeding the offline snapshot.
      gcTime: 5 * 60 * 1000,
      // Ride out transient network blips (flaky cellular) instead of failing to
      // a blank panel after a single dropped request. Bails immediately on 4xx,
      // which won't recover on retry. Panels still show their own "Couldn't
      // load — Retry" state once these attempts are exhausted.
      retry: shouldRetry,
      retryDelay: retryBackoff,
      refetchOnWindowFocus: false,
    },
  },
});

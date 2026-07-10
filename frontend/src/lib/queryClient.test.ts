import { describe, it, expect } from "vitest";
import {
  queryClient,
  statusFromError,
  isRetryableError,
  shouldRetry,
  retryBackoff,
  MAX_QUERY_RETRIES,
} from "./queryClient";
import { PERSISTED_QUERY_GC_TIME, PERSIST_MAX_AGE } from "./queryPersistence";

describe("queryClient defaults", () => {
  it("keeps a modest default gcTime so heavy map payloads don't linger for hours (H7)", () => {
    // The 24h lifetime is opted into per-query (PERSISTED_QUERY_GC_TIME) by
    // the small persisted county-aggregate queries only; the global default
    // must stay short so crashHeatmap/crashClusters batches are collected
    // promptly after unmount.
    expect(queryClient.getDefaultOptions().queries?.gcTime).toBe(5 * 60 * 1000);
  });

  it("persisted queries opt into a gcTime matching the snapshot maxAge", () => {
    expect(PERSISTED_QUERY_GC_TIME).toBe(PERSIST_MAX_AGE);
    expect(PERSISTED_QUERY_GC_TIME).toBe(24 * 60 * 60 * 1000);
  });
});

describe("statusFromError", () => {
  it("extracts the trailing HTTP status from our fetch errors", () => {
    expect(statusFromError(new Error("heatmap 503"))).toBe(503);
    expect(statusFromError(new Error("dashboard batch 500"))).toBe(500);
    expect(statusFromError(new Error("clusters 404"))).toBe(404);
  });

  it("returns null for messages with no recognizable status", () => {
    expect(statusFromError(new Error("Failed to fetch"))).toBeNull();
    expect(statusFromError(new Error("The operation timed out"))).toBeNull();
    // A TimeoutError from AbortSignal.timeout has no status code.
    expect(statusFromError(new DOMException("timeout", "TimeoutError"))).toBeNull();
  });

  it("returns null for non-Error values", () => {
    expect(statusFromError("503")).toBeNull();
    expect(statusFromError(null)).toBeNull();
    expect(statusFromError(undefined)).toBeNull();
  });

  it("ignores out-of-range 3-digit numbers", () => {
    expect(statusFromError(new Error("loaded 800 rows"))).toBeNull();
  });
});

describe("isRetryableError", () => {
  it("retries network/timeout errors (no status)", () => {
    expect(isRetryableError(new Error("Failed to fetch"))).toBe(true);
    expect(isRetryableError(new DOMException("timeout", "TimeoutError"))).toBe(true);
  });

  it("retries 5xx server errors", () => {
    expect(isRetryableError(new Error("heatmap 500"))).toBe(true);
    expect(isRetryableError(new Error("heatmap 503"))).toBe(true);
  });

  it("does NOT retry 4xx client errors — they won't recover", () => {
    expect(isRetryableError(new Error("clusters 400"))).toBe(false);
    expect(isRetryableError(new Error("clusters 404"))).toBe(false);
    expect(isRetryableError(new Error("stats 422"))).toBe(false);
  });

  it("retries 429 rate limits — transient, the bucket refills (L13)", () => {
    expect(isRetryableError(new Error("ask 429"))).toBe(true);
  });
});

describe("shouldRetry", () => {
  it("keeps retrying transient errors until the cap", () => {
    expect(shouldRetry(0, new Error("heatmap 503"))).toBe(true);
    expect(shouldRetry(MAX_QUERY_RETRIES - 1, new Error("heatmap 503"))).toBe(true);
    expect(shouldRetry(MAX_QUERY_RETRIES, new Error("heatmap 503"))).toBe(false);
  });

  it("never retries a 4xx, even on the first failure", () => {
    expect(shouldRetry(0, new Error("stats 422"))).toBe(false);
  });

  it("retries a 429 within the existing budget, then stops at the cap (L13)", () => {
    expect(shouldRetry(0, new Error("ask 429"))).toBe(true);
    expect(shouldRetry(MAX_QUERY_RETRIES - 1, new Error("ask 429"))).toBe(true);
    expect(shouldRetry(MAX_QUERY_RETRIES, new Error("ask 429"))).toBe(false);
  });
});

describe("retryBackoff", () => {
  it("grows exponentially from ~1s", () => {
    // Strip jitter (< 250ms) by flooring to the base.
    expect(Math.floor(retryBackoff(0) / 1000)).toBe(1); // ~1s
    expect(Math.floor(retryBackoff(1) / 1000)).toBe(2); // ~2s
    expect(Math.floor(retryBackoff(2) / 1000)).toBe(4); // ~4s
  });

  it("caps at 15s so a long outage doesn't back off forever", () => {
    expect(retryBackoff(20)).toBeLessThanOrEqual(15_000 + 250);
    expect(retryBackoff(20)).toBeGreaterThanOrEqual(15_000);
  });
});

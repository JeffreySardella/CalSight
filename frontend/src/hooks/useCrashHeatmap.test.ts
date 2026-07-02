import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { useCrashHeatmap, useBatchedHeatmap, FETCH_TIMEOUT_MS, MAX_HEATMAP_POINTS } from "./useCrashHeatmap";

const MOCK_RESPONSE = {
  points: [
    { lat: 34.0, lng: -118.0, weight: 42 },
    { lat: 34.1, lng: -118.1, weight: 17 },
  ],
  total_crashes: 59,
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useCrashHeatmap", () => {
  it("fetches heatmap data when enabled", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(MOCK_RESPONSE)),
    );

    const { result } = renderHook(
      () =>
        useCrashHeatmap({
          enabled: true,
          county: "los-angeles",
          dateRange: { start: { year: 2023, month: 1 }, end: { year: 2023, month: 12 } },
          severities: [],
          causes: [],
          resolution: "medium",
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.points).toEqual(MOCK_RESPONSE.points);
    expect(result.current.totalCrashes).toBe(59);
    expect(spy).toHaveBeenCalledTimes(1);
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain("/api/crashes/heatmap");
    expect(url).toContain("county=los-angeles");
    expect(url).toContain("start=2023-01");
    expect(url).toContain("end=2023-12");
    expect(url).toContain("resolution=medium");
  });

  it("does not fetch when disabled", () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(MOCK_RESPONSE)),
    );

    renderHook(
      () =>
        useCrashHeatmap({
          enabled: false,
          county: null,
          dateRange: null,
          severities: [],
          causes: [],
          resolution: "low",
        }),
      { wrapper: makeWrapper() },
    );

    expect(spy).not.toHaveBeenCalled();
  });

  it("returns empty state on error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("server error", { status: 500 }),
    );

    const { result } = renderHook(
      () =>
        useCrashHeatmap({
          enabled: true,
          county: null,
          dateRange: null,
          severities: [],
          causes: [],
          resolution: "low",
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.points).toEqual([]);
    expect(result.current.totalCrashes).toBe(0);
    expect(result.current.error).toBeTruthy();
  });

  it("passes AbortSignal with timeout to fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(MOCK_RESPONSE)),
    );

    const { result } = renderHook(
      () =>
        useCrashHeatmap({
          enabled: true,
          county: null,
          dateRange: null,
          severities: [],
          causes: [],
          resolution: "low",
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const fetchOptions = spy.mock.calls[0][1] as RequestInit;
    expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    expect(fetchOptions.signal!.aborted).toBe(false);
  });

  it("exports FETCH_TIMEOUT_MS as 15000", () => {
    expect(FETCH_TIMEOUT_MS).toBe(15_000);
  });

  it("exposes refetch that re-runs a failed request", async () => {
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return new Response("server error", { status: 500 });
      return new Response(JSON.stringify(MOCK_RESPONSE));
    });

    const { result } = renderHook(
      () =>
        useCrashHeatmap({
          enabled: true,
          county: null,
          dateRange: null,
          severities: [],
          causes: [],
          resolution: "low",
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.error).toBeTruthy());

    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => expect(result.current.error).toBeFalsy());
    expect(result.current.points).toEqual(MOCK_RESPONSE.points);
  });
});

describe("useBatchedHeatmap", () => {
  const BATCH_1 = {
    points: [{ lat: 34.0, lng: -118.0, weight: 1 }],
    total_crashes: 3,
    batch: 1,
    total_batches: 3,
  };
  const BATCH_2 = {
    points: [{ lat: 34.1, lng: -118.1, weight: 1 }],
    total_crashes: 3,
    batch: 2,
    total_batches: 3,
  };

  it("defaults to 150K batch size", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(BATCH_1)),
    );

    renderHook(
      () =>
        useBatchedHeatmap({
          enabled: true,
          county: "los-angeles",
          dateRange: null,
          severities: [],
          causes: [],
          resolution: "raw",
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain("batch_size=150000");
  });

  it("retains points from earlier batches when a later batch fails", async () => {
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify(BATCH_1));
      }
      return new Response("server error", { status: 500 });
    });

    const { result } = renderHook(
      () =>
        useBatchedHeatmap({
          enabled: true,
          county: "los-angeles",
          dateRange: null,
          severities: [],
          causes: [],
          resolution: "raw",
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.points.length).toBe(1));
    expect(result.current.points).toEqual(BATCH_1.points);
    await waitFor(() => expect(result.current.error).toBeTruthy());
    // Advancement must halt on the failed batch, not skip past it.
    expect(result.current.currentBatch).toBe(2);
  });

  it("advances past a legitimately empty mid-sequence batch", async () => {
    const EMPTY_BATCH_2 = { points: [], total_crashes: 3, batch: 2, total_batches: 3 };
    const BATCH_3 = {
      points: [{ lat: 34.2, lng: -118.2, weight: 1 }],
      total_crashes: 3,
      batch: 3,
      total_batches: 3,
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const batch = new URL(String(input), "http://localhost").searchParams.get("batch");
      if (batch === "1") return new Response(JSON.stringify(BATCH_1));
      if (batch === "2") return new Response(JSON.stringify(EMPTY_BATCH_2));
      return new Response(JSON.stringify(BATCH_3));
    });

    const { result } = renderHook(
      () =>
        useBatchedHeatmap({
          enabled: true,
          county: "los-angeles",
          dateRange: null,
          severities: [],
          causes: [],
          resolution: "raw",
        }),
      { wrapper: makeWrapper() },
    );

    // The empty page 2 must not stall the sequence — batch 3 still loads.
    await waitFor(() => expect(result.current.currentBatch).toBe(3));
    await waitFor(() => expect(result.current.points.length).toBe(2));
    expect(result.current.points).toEqual([...BATCH_1.points, ...BATCH_3.points]);
    await waitFor(() => expect(result.current.hasMore).toBe(false));
    expect(result.current.error).toBeFalsy();
  });

  it("exposes retry function that re-fetches failed batch", async () => {
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return new Response(JSON.stringify(BATCH_1));
      if (callCount === 2) return new Response("fail", { status: 500 });
      return new Response(JSON.stringify(BATCH_2));
    });

    const { result } = renderHook(
      () =>
        useBatchedHeatmap({
          enabled: true,
          county: "los-angeles",
          dateRange: null,
          severities: [],
          causes: [],
          resolution: "raw",
        }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.points.length).toBe(1);
    expect(typeof result.current.retry).toBe("function");

    await act(async () => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.points.length).toBe(2));
    expect(result.current.error).toBeFalsy();
  });

  it("caps accumulation and stops fetching further batches once the ceiling is hit", async () => {
    // Batch 1 alone exceeds the cap. A dense county would otherwise keep
    // pulling millions of points into one array; we must clamp and stop.
    const overCap = MAX_HEATMAP_POINTS + 50;
    const bigPoints = Array.from({ length: overCap }, (_, i) => ({
      lat: 34 + (i % 1000) / 1e6,
      lng: -118 - (i % 1000) / 1e6,
      weight: 1,
    }));
    const BIG_BATCH_1 = { points: bigPoints, total_crashes: overCap, batch: 1, total_batches: 5 };

    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const batch = new URL(String(input), "http://localhost").searchParams.get("batch");
      if (batch === "1") return new Response(JSON.stringify(BIG_BATCH_1));
      // Any batch > 1 would blow past the cap — it must never be requested.
      return new Response(JSON.stringify({ points: [], total_crashes: overCap, batch: Number(batch), total_batches: 5 }));
    });

    const { result } = renderHook(
      () =>
        useBatchedHeatmap({
          enabled: true,
          county: "los-angeles",
          dateRange: null,
          severities: [],
          causes: [],
          resolution: "raw",
        }),
      { wrapper: makeWrapper() },
    );

    // Folding ~600k points is heavy under full-suite parallelism — give the
    // accumulation room beyond waitFor's 1s default.
    await waitFor(() => expect(result.current.capped).toBe(true), { timeout: 10_000 });
    // Clamped exactly to the ceiling, not the over-cap length.
    expect(result.current.points.length).toBe(MAX_HEATMAP_POINTS);
    expect(result.current.hasMore).toBe(false);
    // Only batch 1 was ever fetched — advancement halted at the cap.
    const batchesFetched = spy.mock.calls.map((c) =>
      new URL(String(c[0]), "http://localhost").searchParams.get("batch"),
    );
    expect(batchesFetched).toEqual(["1"]);
  });
});

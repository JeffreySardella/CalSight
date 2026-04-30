import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { useCrashHeatmap } from "./useCrashHeatmap";

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
          years: [2023],
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
    expect(url).toContain("year=2023");
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
          years: [],
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
          years: [],
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
});

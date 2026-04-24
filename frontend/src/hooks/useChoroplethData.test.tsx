import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useChoroplethData, type ChoroplethFilters } from "./useChoroplethData";
import type { MeasureKey } from "../lib/choropleth/measures";

const FILTERS: ChoroplethFilters = {
  years: [2023],
  severities: [],
  causes: [],
};

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useChoroplethData", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches stats and demographics in parallel; omits county filter from stats URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/stats")) {
        return new Response(JSON.stringify([
          { county_code: 19, county_name: "Fresno", crash_count: 10, total_killed: 2, total_injured: 3 },
        ]));
      }
      return new Response(JSON.stringify([
        { county_code: 19, year: 2023, population: 50_000 },
      ]));
    });

    const { result } = renderHook(
      () => useChoroplethData("crashes_per_100k", FILTERS),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/stats") && u.includes("group_by=county") && u.includes("year=2023"))).toBe(true);
    expect(urls.some((u) => u.includes("/api/demographics") && u.includes("year=2023"))).toBe(true);
    expect(urls.every((u) => !u.includes("county="))).toBe(true);
  });

  it("joins stats + demographics and computes the measure per county", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/stats")) {
        return new Response(JSON.stringify([
          { county_code: 19, county_name: "Fresno", crash_count: 10, total_killed: 2, total_injured: 3 },
        ]));
      }
      return new Response(JSON.stringify([
        { county_code: 19, year: 2023, population: 50_000 },
      ]));
    });

    const { result } = renderHook(
      () => useChoroplethData("crashes_per_100k", FILTERS),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.byCountyCode[19]).toEqual({
      value: 20,
      rawCount: 10,
      hasEnoughData: true,
    });
  });

  it("does NOT refetch when only measure changes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([])),
    );
    const wrapper = makeWrapper();
    const { rerender } = renderHook(
      ({ measure }) => useChoroplethData(measure, FILTERS),
      { wrapper, initialProps: { measure: "crashes_per_100k" as MeasureKey } },
    );
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    rerender({ measure: "fatality_rate" });
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("exposes is422 when backend returns 422", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/stats")) {
        return new Response(JSON.stringify({ detail: "bad filter" }), { status: 422 });
      }
      return new Response(JSON.stringify([]));
    });

    const { result } = renderHook(
      () => useChoroplethData("crashes_per_100k", FILTERS),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.is422).toBe(true);
  });

  it("is422 is false for non-422 errors", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/stats")) {
        return new Response("Internal Server Error", { status: 500 });
      }
      return new Response(JSON.stringify([]));
    });

    const { result } = renderHook(
      () => useChoroplethData("crashes_per_100k", FILTERS),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.is422).toBe(false);
  });

  it("marks a county as no-data when population is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/stats")) {
        return new Response(JSON.stringify([
          { county_code: 19, county_name: "Fresno", crash_count: 10, total_killed: 2, total_injured: 3 },
        ]));
      }
      return new Response(JSON.stringify([]));
    });

    const { result } = renderHook(
      () => useChoroplethData("crashes_per_100k", FILTERS),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.byCountyCode[19]).toEqual({
      value: null,
      rawCount: 10,
      hasEnoughData: false,
    });
  });
});

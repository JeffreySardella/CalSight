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
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/stats") && u.includes("group_by=county") && u.includes("year=2023"))).toBe(true);
    expect(urls.some((u) => u.includes("/api/stats") && u.includes("group_by=year"))).toBe(true);
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
      totalKilled: 2,
      totalInjured: 3,
      hasEnoughData: true,
    });
  });

  it("provides a nameToCode mapping from county_name to county_code", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/stats")) {
        return new Response(JSON.stringify([
          { county_code: 19, county_name: "Fresno", crash_count: 10, total_killed: 2, total_injured: 3 },
          { county_code: 1, county_name: "Alameda", crash_count: 5, total_killed: 1, total_injured: 2 },
        ]));
      }
      return new Response(JSON.stringify([]));
    });

    const { result } = renderHook(
      () => useChoroplethData("crashes_raw", FILTERS),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.nameToCode).toEqual({ Fresno: 19, Alameda: 1 });
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
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
    rerender({ measure: "fatality_rate" });
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).toHaveBeenCalledTimes(3);
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

  it("reports missingDemoYears in dataSummary for selected years without demographics", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("group_by=year")) {
        return new Response(JSON.stringify([
          { year: 2023, crash_count: 100_000, total_killed: 10, total_injured: 50 },
          { year: 2024, crash_count: 200_000, total_killed: 20, total_injured: 80 },
          { year: 2025, crash_count: 150_000, total_killed: 15, total_injured: 60 },
        ]));
      }
      if (url.includes("/api/stats")) {
        return new Response(JSON.stringify([
          { county_code: 19, county_name: "Fresno", crash_count: 10, total_killed: 2, total_injured: 3 },
        ]));
      }
      return new Response(JSON.stringify([
        { county_code: 19, year: 2023, population: 50_000 },
      ]));
    });

    const filters: ChoroplethFilters = { years: [2023, 2024, 2025], severities: [], causes: [] };
    const { result } = renderHook(
      () => useChoroplethData("crashes_per_100k", filters),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.dataSummary.missingDemoYears).toEqual([2024, 2025]);
    expect(result.current.dataSummary.totalCrashes).toBe(450_000);
  });

  it("returns empty missingDemoYears in dataSummary when no years are selected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([])));

    const filters: ChoroplethFilters = { years: [], severities: [], causes: [] };
    const { result } = renderHook(
      () => useChoroplethData("crashes_per_100k", filters),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.dataSummary.missingDemoYears).toEqual([]);
  });

  it("reports partialDemoYears in dataSummary when a year has fewer than 58 counties", async () => {
    const demoRows = Array.from({ length: 40 }, (_, i) => ({
      county_code: i + 1,
      year: 2007,
      population: 100_000,
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/stats")) {
        return new Response(JSON.stringify([
          { county_code: 1, county_name: "Alameda", crash_count: 10, total_killed: 1, total_injured: 5 },
        ]));
      }
      return new Response(JSON.stringify(demoRows));
    });

    const filters: ChoroplethFilters = { years: [2007], severities: [], causes: [] };
    const { result } = renderHook(
      () => useChoroplethData("crashes_per_100k", filters),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.dataSummary.partialDemoYears).toEqual([2007]);
    expect(result.current.dataSummary.missingDemoYears).toEqual([]);
  });

  it("flags the current year as in-progress in dataSummary", async () => {
    const currentYear = new Date().getFullYear();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("group_by=year")) {
        return new Response(JSON.stringify([
          { year: currentYear - 1, crash_count: 400_000, total_killed: 100, total_injured: 500 },
          { year: currentYear, crash_count: 487, total_killed: 2, total_injured: 10 },
        ]));
      }
      if (url.includes("/api/stats")) {
        return new Response(JSON.stringify([]));
      }
      return new Response(JSON.stringify([]));
    });

    const filters: ChoroplethFilters = { years: [currentYear - 1, currentYear], severities: [], causes: [] };
    const { result } = renderHook(
      () => useChoroplethData("crashes_raw", filters),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.dataSummary.sparseYears).toEqual([{ year: currentYear, count: 487 }]);
    expect(result.current.dataSummary.totalCrashes).toBe(400_487);
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
      totalKilled: 2,
      totalInjured: 3,
      hasEnoughData: false,
    });
  });
});

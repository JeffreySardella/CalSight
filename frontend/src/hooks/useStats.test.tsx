import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useStats, type StatsFilters } from "./useStats";

const FILTERS: StatsFilters = {
  years: [2022, 2023],
  severities: [],
  causes: [],
  counties: [],
};

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const YEAR_ROWS = [
  { year: 2022, crash_count: 400_000, total_killed: 3800, total_injured: 120_000 },
  { year: 2023, crash_count: 420_000, total_killed: 3600, total_injured: 125_000 },
];

const HOUR_ROWS = Array.from({ length: 24 }, (_, h) => ({
  hour: h,
  crash_count: 1000 + h * 100,
}));

const CAUSE_ROWS = [
  { canonical_cause: "speeding", crash_count: 5000, total_killed: 200, total_injured: 2000 },
  { canonical_cause: "dui", crash_count: 3000, total_killed: 400, total_injured: 1000 },
  { canonical_cause: "lane_change", crash_count: 2000, total_killed: 50, total_injured: 800 },
  { canonical_cause: "other", crash_count: 10_000, total_killed: 100, total_injured: 3000 },
];

const DEMO_ROWS = [
  { county_code: 1, year: 2022, population: 1_600_000 },
  { county_code: 1, year: 2023, population: 1_650_000 },
];

function mockFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("group_by=year")) {
      return new Response(JSON.stringify(YEAR_ROWS));
    }
    if (url.includes("group_by=hour")) {
      return new Response(JSON.stringify(HOUR_ROWS));
    }
    if (url.includes("group_by=cause")) {
      return new Response(JSON.stringify(CAUSE_ROWS));
    }
    if (url.includes("/api/demographics")) {
      return new Response(JSON.stringify(DEMO_ROWS));
    }
    return new Response(JSON.stringify([]));
  });
}

describe("useStats", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fires 3 parallel fetches with correct group_by and filter params", async () => {
    const spy = mockFetch();
    const { result } = renderHook(() => useStats(FILTERS), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(spy).toHaveBeenCalledTimes(7);
    const urls = spy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("group_by=year") && u.includes("year=2022%2C2023"))).toBe(true);
    expect(urls.some((u) => u.includes("group_by=hour") && u.includes("year=2022%2C2023"))).toBe(true);
    expect(urls.some((u) => u.includes("group_by=cause") && u.includes("year=2022%2C2023"))).toBe(true);
    expect(urls.some((u) => u.includes("/api/demographics") && u.includes("year=2022%2C2023"))).toBe(true);
    expect(urls.some((u) => u.includes("group_by=severity"))).toBe(true);
    expect(urls.some((u) => u.includes("group_by=gender"))).toBe(true);
    expect(urls.some((u) => u.includes("group_by=age_bracket"))).toBe(true);
  });

  it("maps API responses to chart data shapes", async () => {
    mockFetch();
    const { result } = renderHook(() => useStats(FILTERS), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const data = result.current.data!;
    expect(data.hourlyData).toHaveLength(24);
    expect(data.hourlyData[0]).toEqual({ hour: 0, count: 1000 });

    expect(data.yearlyData).toHaveLength(2);
    expect(data.yearlyData[0]).toEqual({ year: 2022, count: 400_000 });

    expect(data.causesData).toHaveLength(4);
    expect(data.causesData[0]).toEqual({ label: "Speeding", count: 5000 });
    expect(data.causesData[2]).toEqual({ label: "Lane Change", count: 2000 });
  });

  it("computes hero metrics from year data", async () => {
    mockFetch();
    const { result } = renderHook(() => useStats(FILTERS), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const hero = result.current.data!.heroMetrics;
    expect(hero.totalIncidents).toBe(820_000);
    // YoY incident %: (420000 - 400000) / 400000 * 100 = 5.0
    expect(hero.incidentYoYPct).toBeCloseTo(5.0, 1);
    // YoY fatality %: (3600 - 3800) / 3800 * 100 = -5.3
    expect(hero.yoyFatalityChangePct).toBeCloseTo(-5.3, 1);
    // KSI = (7400 killed + 245000 injured) / 3250000 pop * 100k = 7766.2
    expect(hero.ksiRatePer100k).toBeCloseTo(7766.2, 0);
  });

  it("excludes current year from YoY calculations", async () => {
    const currentYear = new Date().getFullYear();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("group_by=year")) {
        return new Response(JSON.stringify([
          { year: currentYear - 2, crash_count: 400_000, total_killed: 3800, total_injured: 120_000 },
          { year: currentYear - 1, crash_count: 420_000, total_killed: 3600, total_injured: 125_000 },
          { year: currentYear, crash_count: 5_000, total_killed: 50, total_injured: 2_000 },
        ]));
      }
      if (url.includes("group_by=hour")) return new Response(JSON.stringify(HOUR_ROWS));
      if (url.includes("group_by=cause")) return new Response(JSON.stringify(CAUSE_ROWS));
      return new Response(JSON.stringify([]));
    });
    const { result } = renderHook(() => useStats(FILTERS), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const hero = result.current.data!.heroMetrics;
    expect(hero.totalIncidents).toBe(825_000);
    expect(hero.incidentYoYPct).toBeCloseTo(5.0, 1);
    expect(hero.yoyFatalityChangePct).toBeCloseTo(-5.3, 1);
  });

  it("returns loading=true while fetching", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise(() => {}), // never resolves
    );
    const { result } = renderHook(() => useStats(FILTERS), {
      wrapper: makeWrapper(),
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
  });

  it("returns error string when a fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    );
    const { result } = renderHook(() => useStats(FILTERS), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.loading).toBe(false);
  });
});

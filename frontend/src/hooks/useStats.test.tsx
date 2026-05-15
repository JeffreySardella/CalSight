import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useStats, type StatsFilters } from "./useStats";

const FILTERS: StatsFilters = {
  dateRange: { start: { year: 2022, month: 1 }, end: { year: 2023, month: 12 } },
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
    if (url.includes("/api/stats/batch")) {
      return new Response(JSON.stringify({
        year: YEAR_ROWS,
        hour: HOUR_ROWS,
        cause: CAUSE_ROWS,
        severity: [],
        gender: [],
        age_bracket: [],
        at_fault_gender: [],
        at_fault_age_bracket: [],
        month: [],
        day_of_week: [],
        rate: [],
      }));
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

  it("fires batch POST + demographics GET", async () => {
    const spy = mockFetch();
    const { result } = renderHook(() => useStats(FILTERS), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(spy).toHaveBeenCalledTimes(2);
    const batchCall = spy.mock.calls.find(c => String(c[0]).includes("/api/stats/batch"));
    expect(batchCall).toBeDefined();
    const body = JSON.parse((batchCall![1] as RequestInit).body as string);
    expect(body.groups).toContain("year");
    expect(body.groups).toContain("hour");
    expect(body.groups).toContain("cause");
    expect(body.start).toBe("2022-01");
    expect(body.end).toBe("2023-12");
  });

  it("maps at-fault demographic responses to chart data points", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/stats/batch")) {
        return new Response(JSON.stringify({
          year: YEAR_ROWS,
          hour: HOUR_ROWS,
          cause: CAUSE_ROWS,
          severity: [],
          gender: [],
          age_bracket: [],
          at_fault_gender: [
            { gender: "M", party_count: 7000, fatal_party_count: 200 },
            { gender: "F", party_count: 3000, fatal_party_count: 80 },
            { gender: "U", party_count: 100, fatal_party_count: 1 },
          ],
          at_fault_age_bracket: [
            { age_bracket: "25_44", party_count: 5000, fatal_party_count: 100 },
            { age_bracket: "18_24", party_count: 2500, fatal_party_count: 60 },
            { age_bracket: "45_64", party_count: 2000, fatal_party_count: 40 },
            { age_bracket: "over_65", party_count: 800, fatal_party_count: 30 },
            { age_bracket: "under_18", party_count: 200, fatal_party_count: 5 },
            { age_bracket: "unknown", party_count: 50, fatal_party_count: 0 },
          ],
          month: [],
          day_of_week: [],
          rate: [],
        }));
      }
      if (url.includes("/api/demographics")) return new Response(JSON.stringify(DEMO_ROWS));
      return new Response(JSON.stringify([]));
    });

    const { result } = renderHook(() => useStats(FILTERS), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const data = result.current.data!;
    // "U" passes through — matches the existing victim Gender chart behavior
    // (the filter excludes the literal string "unknown", but the MV stores
    // the value as "U"). Worth a follow-up to filter both, but out of scope.
    expect(data.atFaultGenderData).toEqual([
      { label: "M", count: 7000 },
      { label: "F", count: 3000 },
      { label: "U", count: 100 },
    ]);
    // Sorted by AGE_ORDER (under_18 → over_65), with "unknown" filtered out.
    expect(data.atFaultAgeBracketData.map((r) => r.label)).toEqual([
      "Under 18", "18–24", "25–44", "45–64", "65+",
    ]);
    expect(data.atFaultAgeBracketData.find((r) => r.label === "25–44")?.count).toBe(5000);
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
    expect(data.yearlyData[0]).toEqual({ year: 2022, count: 400_000, killed: 3800, injured: 120_000 });

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
      if (url.includes("/api/stats/batch")) {
        return new Response(JSON.stringify({
          year: [
            { year: currentYear - 2, crash_count: 400_000, total_killed: 3800, total_injured: 120_000 },
            { year: currentYear - 1, crash_count: 420_000, total_killed: 3600, total_injured: 125_000 },
            { year: currentYear, crash_count: 5_000, total_killed: 50, total_injured: 2_000 },
          ],
          hour: HOUR_ROWS,
          cause: CAUSE_ROWS,
          severity: [],
          gender: [],
          age_bracket: [],
          at_fault_gender: [],
          at_fault_age_bracket: [],
          month: [],
          day_of_week: [],
          rate: [],
        }));
      }
      if (url.includes("/api/demographics")) return new Response(JSON.stringify(DEMO_ROWS));
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

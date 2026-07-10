import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDashboardData } from "./useDashboardData";
import type { ChartSlot } from "../lib/dashboard/types";
import type { StatsFilters } from "./useStats";

const FILTERS: StatsFilters = {
  dateRange: null,
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

// Years must be < current year — transformRows drops the (partial) current year.
const YEAR_ROWS = [
  { year: 2022, crash_count: 400, total_killed: 40, total_injured: 120 },
  { year: 2023, crash_count: 500, total_killed: 25, total_injured: 125 },
];

function mockFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/stats/batch")) {
      return new Response(JSON.stringify({ year: YEAR_ROWS }));
    }
    return new Response(JSON.stringify({}));
  });
}

describe("useDashboardData", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("populates both primary and secondary keys for a dual-axis chart — M15", async () => {
    mockFetch();
    const charts: ChartSlot[] = [
      {
        id: "a",
        dimension: "year",
        measure: "count",
        secondaryMeasure: "killed",
        chartType: "line",
        order: 0,
      },
    ];

    const { result } = renderHook(() => useDashboardData(charts, FILTERS), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Primary series under the slot key.
    expect(result.current.dataBySlot["year:count"]).toBeDefined();
    expect(result.current.dataBySlot["year:count"].map((d) => d.value)).toEqual([400, 500]);

    // Secondary series under the plain `${dimension}:${secondaryMeasure}` key
    // that DashboardGrid's secondarySlotKey reads.
    expect(result.current.dataBySlot["year:killed"]).toBeDefined();
    expect(result.current.dataBySlot["year:killed"].map((d) => d.value)).toEqual([40, 25]);
  });

  it("applies derived-measure math to the secondary series", async () => {
    mockFetch();
    const charts: ChartSlot[] = [
      {
        id: "a",
        dimension: "year",
        measure: "count",
        secondaryMeasure: "fatality_rate",
        chartType: "line",
        order: 0,
      },
    ];

    const { result } = renderHook(() => useDashboardData(charts, FILTERS), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // fatality_rate = killed / crashes × 100, rounded to 2 decimals:
    // 2022: 40/400 = 10%, 2023: 25/500 = 5%.
    expect(result.current.dataBySlot["year:fatality_rate"].map((d) => d.value)).toEqual([10, 5]);
  });

  it("does not emit a secondary key for single-axis charts", async () => {
    mockFetch();
    const charts: ChartSlot[] = [
      { id: "a", dimension: "year", measure: "count", chartType: "bar", order: 0 },
    ];

    const { result } = renderHook(() => useDashboardData(charts, FILTERS), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(Object.keys(result.current.dataBySlot)).toEqual(["year:count"]);
  });

  it("keeps the primary chart's option-suffixed key separate from the secondary key", async () => {
    mockFetch();
    // A chart with display options gets a suffixed slot key (year:count:cum);
    // its secondary key stays the plain form the grid reads.
    const charts: ChartSlot[] = [
      {
        id: "a",
        dimension: "year",
        measure: "count",
        secondaryMeasure: "killed",
        chartType: "line",
        order: 0,
        options: { cumulative: true },
      },
    ];

    const { result } = renderHook(() => useDashboardData(charts, FILTERS), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Primary is cumulative under its suffixed key…
    expect(result.current.dataBySlot["year:count:cum"].map((d) => d.value)).toEqual([400, 900]);
    // …while the secondary series is untouched by the chart's display options.
    expect(result.current.dataBySlot["year:killed"].map((d) => d.value)).toEqual([40, 25]);
  });
});

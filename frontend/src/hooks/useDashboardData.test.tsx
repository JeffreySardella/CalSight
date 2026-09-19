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

    // fatality_rate = deaths per 1,000 crashes, one decimal:
    // 2022: 40/400 = 100 per 1,000, 2023: 25/500 = 50 per 1,000.
    expect(result.current.dataBySlot["year:fatality_rate"].map((d) => d.value)).toEqual([100, 50]);
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

  it("maps mode rows to labelled people counts — victim_count, not crash_count", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/api/stats/batch")) {
        return new Response(JSON.stringify({
          mode: [
            { mode: "occupant", victim_count: 900, fatal_victim_count: 30 },
            { mode: "pedestrian", victim_count: 140, fatal_victim_count: 50 },
            { mode: "motorcyclist", victim_count: 120, fatal_victim_count: 20 },
            { mode: "cyclist", victim_count: 90, fatal_victim_count: 5 },
          ],
        }));
      }
      return new Response(JSON.stringify({}));
    });

    const charts: ChartSlot[] = [
      { id: "a", dimension: "mode", measure: "count", chartType: "bar", order: 0 },
      { id: "b", dimension: "mode", measure: "killed", chartType: "bar", order: 1 },
    ];

    const { result } = renderHook(() => useDashboardData(charts, FILTERS), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.dataBySlot["mode:count"]).toEqual([
      { label: "Vehicle Occupant", value: 900, x: 0, y: 0 },
      { label: "Pedestrian", value: 140, x: 0, y: 0 },
      { label: "Motorcyclist", value: 120, x: 0, y: 0 },
      { label: "Cyclist", value: 90, x: 0, y: 0 },
    ]);
    // mode rows are victim rows: `killed` reads fatal_victim_count, the same
    // field the gender rows use, not total_killed.
    expect(result.current.dataBySlot["mode:killed"].map((d) => d.value))
      .toEqual([30, 50, 20, 5]);
  });

  it("degrades to empty when a group returns an in-band incompatibility object", async () => {
    // Regression: /api/stats/batch reports a filter that doesn't apply to a
    // dimension as `{"error": ..., "filter": ...}` INSIDE a 200. `?? []` lets
    // that object through to transformRows, which threw and crashed the whole
    // Dashboard Builder. It must render an empty chart instead.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/stats/batch")) {
        return new Response(JSON.stringify({
          year: YEAR_ROWS,
          gender: { error: "pedestrian is not supported for gender", filter: "pedestrian" },
        }));
      }
      return new Response(JSON.stringify({}));
    });

    const charts: ChartSlot[] = [
      { id: "a", dimension: "year", measure: "count", chartType: "line", order: 0 },
      { id: "b", dimension: "gender", measure: "count", chartType: "bar", order: 1 },
    ];

    const { result } = renderHook(() => useDashboardData(charts, FILTERS), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The incompatible dimension is empty, the compatible one still renders.
    expect(result.current.dataBySlot["gender:count"]).toEqual([]);
    expect(result.current.dataBySlot["year:count"].map((d) => d.value)).toEqual([400, 500]);
  });

  describe("person-level dimension measures (gender/age_bracket)", () => {
    // Gender rows carry victim_count/fatal_victim_count, not crash_count/
    // total_killed/total_injured — those are crash-level fields.
    const GENDER_ROWS = [
      { gender: "male", victim_count: 100, fatal_victim_count: 8 },
      { gender: "female", victim_count: 60, fatal_victim_count: 2 },
    ];

    function mockGenderFetch() {
      return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("/api/stats/batch")) {
          return new Response(JSON.stringify({ gender: GENDER_ROWS }));
        }
        return new Response(JSON.stringify({}));
      });
    }

    it("count = victim_count", async () => {
      mockGenderFetch();
      const charts: ChartSlot[] = [
        { id: "a", dimension: "gender", measure: "count", chartType: "bar", order: 0 },
      ];
      const { result } = renderHook(() => useDashboardData(charts, FILTERS), { wrapper: makeWrapper() });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.dataBySlot["gender:count"].map((d) => d.value)).toEqual([100, 60]);
    });

    it("killed = fatal_victim_count", async () => {
      mockGenderFetch();
      const charts: ChartSlot[] = [
        { id: "a", dimension: "gender", measure: "killed", chartType: "bar", order: 0 },
      ];
      const { result } = renderHook(() => useDashboardData(charts, FILTERS), { wrapper: makeWrapper() });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.dataBySlot["gender:killed"].map((d) => d.value)).toEqual([8, 2]);
    });

    it("injured = victim_count - fatal_victim_count (excludes the killed)", async () => {
      mockGenderFetch();
      const charts: ChartSlot[] = [
        { id: "a", dimension: "gender", measure: "injured", chartType: "bar", order: 0 },
      ];
      const { result } = renderHook(() => useDashboardData(charts, FILTERS), { wrapper: makeWrapper() });
      await waitFor(() => expect(result.current.loading).toBe(false));
      // Before the fix this fell through to victim_count (100, 60) — the killed
      // were double-counted as "injured" too.
      expect(result.current.dataBySlot["gender:injured"].map((d) => d.value)).toEqual([92, 58]);
    });

    it("injured never goes below 0 even if fatal_victim_count exceeds victim_count", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("/api/stats/batch")) {
          return new Response(JSON.stringify({
            gender: [{ gender: "male", victim_count: 5, fatal_victim_count: 9 }],
          }));
        }
        return new Response(JSON.stringify({}));
      });
      const charts: ChartSlot[] = [
        { id: "a", dimension: "gender", measure: "injured", chartType: "bar", order: 0 },
      ];
      const { result } = renderHook(() => useDashboardData(charts, FILTERS), { wrapper: makeWrapper() });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.dataBySlot["gender:injured"].map((d) => d.value)).toEqual([0]);
    });
  });
});

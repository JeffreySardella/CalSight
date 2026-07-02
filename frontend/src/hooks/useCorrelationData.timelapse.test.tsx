import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCorrelationData, type CorrelationFilters } from "./useCorrelationData";

/**
 * H-F7 regression: during timelapse playback the animated year is embedded in
 * the correlation filters. Only the crash-level stats/batch call is year
 * dependent; the ~7 supplemental county-reference endpoints are not. Advancing
 * the year must NOT re-key / refetch those supplemental endpoints.
 */

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const SUPPLEMENTAL_ENDPOINTS = [
  "/api/demographics",
  "/api/calenviroscreen",
  "/api/unemployment",
  "/api/vehicles",
  "/api/weather",
  "/api/fars",
  "/api/tract-density",
];

function countCalls(spy: ReturnType<typeof vi.spyOn>, substr: string): number {
  return spy.mock.calls.filter((c: unknown[]) => String(c[0]).includes(substr)).length;
}

function yearFilters(year: number): CorrelationFilters {
  return { dateRange: { start: { year, month: 1 }, end: { year, month: 12 } } };
}

describe("useCorrelationData timelapse decoupling", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("refetches stats/batch per year but fetches supplemental endpoints only once", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/stats/batch")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              county: [
                { county_code: 19, county_name: "Los Angeles", crash_count: 100, total_killed: 5, total_injured: 40 },
                { county_code: 37, county_name: "Orange", crash_count: 60, total_killed: 2, total_injured: 20 },
              ],
            }),
          ),
        );
      }
      return Promise.resolve(new Response("[]"));
    });

    const { result, rerender } = renderHook(
      ({ filters }: { filters: CorrelationFilters }) => useCorrelationData(filters),
      { wrapper: wrapper(), initialProps: { filters: yearFilters(2018) } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(countCalls(spy, "/api/stats/batch")).toBe(1);
    for (const ep of SUPPLEMENTAL_ENDPOINTS) {
      expect(countCalls(spy, ep)).toBe(1);
    }

    // Simulate the timelapse ticker advancing the animated year.
    for (const y of [2019, 2020, 2021]) {
      rerender({ filters: yearFilters(y) });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
    }

    // Year-dependent stats/batch is refetched once per distinct year (4 total)…
    await waitFor(() => expect(countCalls(spy, "/api/stats/batch")).toBe(4));

    // …but every filter-independent supplemental endpoint was fetched exactly once.
    for (const ep of SUPPLEMENTAL_ENDPOINTS) {
      expect(countCalls(spy, ep)).toBe(1);
    }
  });
});

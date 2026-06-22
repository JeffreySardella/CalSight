import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useHighwayRankings } from "./useHighwayRankings";
import type { StatsFilters } from "./useStats";

const BASE_FILTERS: StatsFilters = {
  dateRange: null,
  severities: [],
  causes: [],
  counties: [],
};

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useHighwayRankings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requests /api/stats/highways with sort + limit", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([
        {
          route_number: "I-5",
          crash_count: 100,
          total_killed: 5,
          total_injured: 30,
          fatality_rate: 0.05,
          miles: 796,
          crashes_per_mile: 0.13,
        },
      ])),
    );
    const { result } = renderHook(
      () => useHighwayRankings(BASE_FILTERS, "fatality_rate", 10),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(spy).toHaveBeenCalledTimes(1);
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain("/api/stats/highways");
    expect(url).toContain("sort=fatality_rate");
    expect(url).toContain("limit=10");
    expect(result.current.data?.[0].route_number).toBe("I-5");
  });

  it("encodes severity slugs and county filters", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]"));
    const filters: StatsFilters = {
      ...BASE_FILTERS,
      severities: ["Fatal", "Injury"],
      counties: ["los-angeles", "orange"],
    };
    renderHook(() => useHighwayRankings(filters), { wrapper: wrapper() });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain("severity=fatal%2Cinjury");
    expect(url).toContain("county=los-angeles%2Corange");
  });

  it("forwards a date range as start/end YYYY-MM", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]"));
    const filters: StatsFilters = {
      ...BASE_FILTERS,
      dateRange: {
        start: { year: 2023, month: 1 },
        end: { year: 2023, month: 12 },
      },
    };
    renderHook(() => useHighwayRankings(filters), { wrapper: wrapper() });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain("start=2023-01");
    expect(url).toContain("end=2023-12");
  });

  it("propagates fetch errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    const { result } = renderHook(
      () => useHighwayRankings(BASE_FILTERS),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});

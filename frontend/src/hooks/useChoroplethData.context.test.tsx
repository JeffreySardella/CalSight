import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useChoroplethData, type ChoroplethFilters } from "./useChoroplethData";

const FILTERS: ChoroplethFilters = {
  dateRange: { start: { year: 2023, month: 1 }, end: { year: 2023, month: 12 } },
  severities: [],
  causes: [],
};

const STATS = [
  { county_code: 19, county_name: "Fresno", crash_count: 10, total_killed: 2, total_injured: 3 },
];

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useChoroplethData — context measures", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("averages monthly unemployment rates per county for the unemployment measure", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/unemployment")) {
        return new Response(JSON.stringify([
          { county_code: 19, year: 2023, month: 1, unemployment_rate: 4.0 },
          { county_code: 19, year: 2023, month: 2, unemployment_rate: 6.0 },
          { county_code: 19, year: 2023, month: 3, unemployment_rate: null }, // ignored
          { county_code: 1, year: 2023, month: 1, unemployment_rate: 3.0 },
        ]));
      }
      if (url.includes("/api/stats")) {
        return new Response(JSON.stringify(STATS));
      }
      return new Response(JSON.stringify([]));
    });

    const { result } = renderHook(
      () => useChoroplethData("unemployment_rate", FILTERS),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // (4.0 + 6.0) / 2 — the null month must not drag the average down.
    expect(result.current.byCountyCode[19]).toMatchObject({ value: 5.0, hasEnoughData: true });

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/unemployment") && u.includes("start=2023-01"))).toBe(true);
    // The CalEnviroScreen query stays disabled for the unemployment measure.
    expect(urls.some((u) => u.includes("/api/calenviroscreen"))).toBe(false);
  });

  it("joins CalEnviroScreen scores for ces measures and skips the unemployment endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/calenviroscreen")) {
        return new Response(JSON.stringify([
          { county_code: 19, ces_score: 44.3, pollution_burden: 7.1, traffic_score: 2.5 },
        ]));
      }
      if (url.includes("/api/stats")) {
        return new Response(JSON.stringify(STATS));
      }
      return new Response(JSON.stringify([]));
    });

    const { result } = renderHook(
      () => useChoroplethData("ces_score", FILTERS),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.byCountyCode[19]).toMatchObject({ value: 44.3, hasEnoughData: true });

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/calenviroscreen"))).toBe(true);
    expect(urls.some((u) => u.includes("/api/unemployment"))).toBe(false);
  });

  it("marks counties without context data as no-data instead of zero", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/calenviroscreen")) {
        return new Response(JSON.stringify([])); // no rows for any county
      }
      if (url.includes("/api/stats")) {
        return new Response(JSON.stringify(STATS));
      }
      return new Response(JSON.stringify([]));
    });

    const { result } = renderHook(
      () => useChoroplethData("ces_score", FILTERS),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.byCountyCode[19]).toMatchObject({ value: null, hasEnoughData: false });
  });
});

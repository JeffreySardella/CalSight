import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useFacetCounts } from "./useFacetCounts";
import type { StagedFilters } from "./useStagedFilters";

const BASE_STAGED: StagedFilters = {
  selectedYears: new Set(),
  dateRange: null,
  severities: new Set(),
  causes: new Set(),
  alcohol: false,
  distracted: false,
  pedestrian: false,
  cyclist: false,
  drug: false,
  driverAge: null,
  weather: new Set(),
  lighting: new Set(),
  collisionType: new Set(),
  roadType: null,
  hitRun: false,
};

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useFacetCounts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("group_by=year")) {
        return new Response(JSON.stringify([{ year: 2022, crash_count: 30 }, { year: 2023, crash_count: 70 }]));
      }
      if (url.includes("group_by=severity")) {
        return new Response(JSON.stringify([{ severity: "Fatal", crash_count: 5 }]));
      }
      if (url.includes("group_by=cause")) {
        return new Response(JSON.stringify([{ canonical_cause: "speeding_unsafe", crash_count: 40 }]));
      }
      if (url.includes("group_by=weather")) {
        return new Response(JSON.stringify([
          { value: "clear", crash_count: 80 },
          { value: "unknown", crash_count: 20 },
        ]));
      }
      if (url.includes("group_by=lighting") || url.includes("group_by=collision_type")) {
        return new Response(JSON.stringify([]));
      }
      // Every other call is one of the fetchCount(url) single-condition counts.
      if (url.includes("driver_age=16-21")) return new Response(JSON.stringify({ total_crashes: 3 }));
      return new Response(JSON.stringify({ total_crashes: 1 }));
    });
  });

  it("shapes year/severity/cause group-by rows into keyed records", async () => {
    const { result } = renderHook(() => useFacetCounts(BASE_STAGED), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(result.current.years).toEqual({ 2022: 30, 2023: 70 });
    expect(result.current.severities).toEqual({ Fatal: 5 });
  });

  it("keys causes by both the slugified and the raw canonical form", async () => {
    const { result } = renderHook(() => useFacetCounts(BASE_STAGED), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(result.current.causes["speeding-unsafe"]).toBe(40);
    expect(result.current.causes["speeding_unsafe"]).toBe(40);
  });

  it("drops the 'unknown' bucket from condition facets", async () => {
    const { result } = renderHook(() => useFacetCounts(BASE_STAGED), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(result.current.conditions.weather).toEqual({ clear: 80 });
  });

  it("reports driver-age band counts from the single-condition fetches", async () => {
    const { result } = renderHook(() => useFacetCounts(BASE_STAGED), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(result.current.driverAge["16-21"]).toBe(3);
    expect(result.current.driverAge["22-34"]).toBe(1);
  });

  it("scopes every count to the picked counties", async () => {
    const { result } = renderHook(
      () => useFacetCounts(BASE_STAGED, new Set(["Los Angeles", "Fresno"])),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const urls = vi.mocked(globalThis.fetch).mock.calls.map((c) => new URL(String(c[0]), "http://x"));
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u.searchParams.get("county")).toBe("fresno,los-angeles");
  });

  it("stays statewide with no county picked", async () => {
    const { result } = renderHook(() => useFacetCounts(BASE_STAGED, new Set()), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const urls = vi.mocked(globalThis.fetch).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("county="))).toBe(false);
  });

  it("starts loading before data resolves", () => {
    const { result } = renderHook(() => useFacetCounts(BASE_STAGED), { wrapper: makeWrapper() });
    expect(result.current.loading).toBe(true);
    expect(result.current.loaded).toBe(false);
  });
});

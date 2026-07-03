import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useStreetAggregation } from "./useIntersections";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useStreetAggregation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requests /api/intersections with county and year params", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([
        {
          county_code: 19,
          county_name: "Los Angeles",
          primary_road: "Main St",
          secondary_road: "1st Ave",
          crash_count: 42,
          fatal_count: 1,
          injury_count: 20,
          pdo_count: 21,
          killed: 1,
          injured: 25,
          latitude: 34.0,
          longitude: -118.2,
        },
      ])),
    );
    const { result } = renderHook(
      () =>
        useStreetAggregation({
          scope: "intersections",
          county: "los-angeles",
          yearStart: 2019,
          yearEnd: 2023,
          minCrashes: 2,
          limit: 25,
        }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(spy).toHaveBeenCalledTimes(1);
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain("/api/intersections");
    expect(url).toContain("county=los-angeles");
    expect(url).toContain("year_start=2019");
    expect(url).toContain("year_end=2023");
    expect(url).toContain("min_crashes=2");
    expect(url).toContain("limit=25");
    expect(result.current.data?.[0].primary_road).toBe("Main St");
  });

  it("sends the pedestrian flag when the pedestrian mode is active", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]"));
    renderHook(
      () => useStreetAggregation({ scope: "intersections", pedestrian: true }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain("pedestrian=true");
    expect(url).not.toContain("cyclist=");
  });

  it("hits /api/corridors and omits county when statewide", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]"));
    renderHook(
      () => useStreetAggregation({ scope: "corridors", minCrashes: 5, limit: 25 }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain("/api/corridors");
    expect(url).not.toContain("county=");
    expect(url).toContain("min_crashes=5");
  });

  it("builds distinct query keys per scope and county so caches don't collide", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(
      () => useStreetAggregation({ scope: "intersections", county: "orange" }),
      { wrapper: wrap },
    );
    renderHook(
      () => useStreetAggregation({ scope: "corridors", county: "orange" }),
      { wrapper: wrap },
    );
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    const urls = spy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/intersections"))).toBe(true);
    expect(urls.some((u) => u.includes("/api/corridors"))).toBe(true);
  });

  it("propagates fetch errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    const { result } = renderHook(
      () => useStreetAggregation({ scope: "intersections" }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });

  it("does not fetch when disabled", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]"));
    renderHook(
      () => useStreetAggregation({ scope: "intersections", enabled: false }),
      { wrapper: wrapper() },
    );
    // Give react-query a tick; no request should fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).not.toHaveBeenCalled();
  });
});

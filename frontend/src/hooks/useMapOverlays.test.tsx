import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSchools, useHospitals, type School } from "./useMapOverlays";

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function school(cds: string): School {
  return { cds_code: cds, school_name: cds, county_code: 1, city: "Fresno", latitude: 36.7, longitude: -119.8, school_type: null, status: null };
}

describe("useSchools", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("pages through /api/schools until a short page ends it, concatenating results", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const offset = Number(new URL(url, "http://x").searchParams.get("offset"));
      if (offset === 0) {
        return new Response(JSON.stringify(Array.from({ length: 5000 }, (_, i) => school(`p0-${i}`))));
      }
      // Second (final) page is shorter than the 5000 page size.
      return new Response(JSON.stringify([school("p1-0"), school("p1-1")]));
    });

    const { result } = renderHook(() => useSchools(true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.current.data).toHaveLength(5002);
    expect(result.current.data?.[5001].cds_code).toBe("p1-1");
  });

  it("unwraps a {items: [...]} response shape, not just a bare array", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ items: [school("a"), school("b")] })),
    );

    const { result } = renderHook(() => useSchools(true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([school("a"), school("b")]);
  });

  it("does not fetch when disabled", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([])));
    renderHook(() => useSchools(false), { wrapper: makeWrapper() });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("useHospitals", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("does not fetch when disabled", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([])));
    renderHook(() => useHospitals(false), { wrapper: makeWrapper() });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

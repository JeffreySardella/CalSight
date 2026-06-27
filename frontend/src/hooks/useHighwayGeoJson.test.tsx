import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { useHighwayGeoJson } from "./useHighwayGeoJson";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("loads the highway geojson", async () => {
  const fc = { type: "FeatureCollection", features: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => fc }),
  );
  const { result } = renderHook(() => useHighwayGeoJson(), { wrapper });
  await waitFor(() => expect(result.current.data).toEqual(fc));
});

it("errors when the fetch fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, status: 404 }),
  );
  const { result } = renderHook(() => useHighwayGeoJson(), { wrapper });
  await waitFor(() => expect(result.current.isError).toBe(true));
});

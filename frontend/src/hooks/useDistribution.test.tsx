import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDistribution } from "./useDistribution";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const rows = [{ county_code: 15, county_name: "Kern", value: 100 }];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => rows })) as unknown as typeof fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("useDistribution", () => {
  it("fetches with metric + year and returns adapted points", async () => {
    const { result } = renderHook(() => useDistribution("crash_count", 2023, { enabled: true }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([{ id: "kern", name: "Kern", value: 100 }]);
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("metric=crash_count");
    expect(url).toContain("year=2023");
  });

  it("omits year from the URL when year is null", async () => {
    const { result } = renderHook(() => useDistribution("crash_count", null, { enabled: true }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).not.toContain("year=");
  });

  it("does not fetch when disabled", () => {
    renderHook(() => useDistribution("crash_count", null, { enabled: false }), { wrapper: wrapper() });
    expect(fetch).not.toHaveBeenCalled();
  });
});

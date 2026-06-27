import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useApiHealth } from "./useApiHealth";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe("useApiHealth", () => {
  it("maps a 200 rebuilding body to 'rebuilding'", async () => {
    vi.mocked(fetch).mockResolvedValue({
      status: 200, ok: true, json: async () => ({ status: "rebuilding" }),
    } as Response);
    const { result } = renderHook(() => useApiHealth(), { wrapper });
    await waitFor(() => expect(result.current).toBe("rebuilding"));
  });

  it("maps a 200 ok body to 'ok'", async () => {
    vi.mocked(fetch).mockResolvedValue({
      status: 200, ok: true, json: async () => ({ status: "ok" }),
    } as Response);
    const { result } = renderHook(() => useApiHealth(), { wrapper });
    await waitFor(() => expect(result.current).toBe("ok"));
  });
});

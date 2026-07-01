import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { useAskAi } from "./useAskAi";

function okResponse(answer: string): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      answer,
      provider: "test",
      suggestions: [],
      chart: null,
      grounded: true,
      filters_used: {},
      tools_called: [],
    }),
  } as unknown as Response;
}

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

describe("useAskAi", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("allows a second question after the first completes (inFlightRef is reset)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse("hello"));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAskAi(), { wrapper });

    await act(async () => {
      await result.current.sendMessage("first question");
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Jump past the 15s per-question cooldown; this test pins the
    // inFlightRef reset, not the cooldown (covered below).
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 20_000);

    await act(async () => {
      await result.current.sendMessage("second question");
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("blocks a second question while the cooldown is active (no bypass via direct sendMessage)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse("hello"));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAskAi(), { wrapper });

    await act(async () => {
      await result.current.sendMessage("first question");
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Still inside the 15s cooldown — every caller (Ask AI page, AI
    // companion "Go deeper", retry) goes through sendMessage, so this
    // must refuse rather than fire another request.
    await act(async () => {
      await result.current.sendMessage("second question");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.error).toMatch(/wait/i);
  });
});

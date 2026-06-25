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

    await act(async () => {
      await result.current.sendMessage("second question");
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

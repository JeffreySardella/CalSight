import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, act, waitFor, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { useAskAi, AskAiProvider } from "./useAskAi";

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

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <AskAiProvider>{children}</AskAiProvider>
  </MemoryRouter>
);

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

  it("retry does not put the resent question in the LLM history twice (M-F6)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse("answer"));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAskAi(), { wrapper });

    await act(async () => { await result.current.sendMessage("repeat me"); });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Jump past the per-question cooldown so retry actually re-fires.
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 20_000);

    await act(async () => { result.current.retry(); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const retryBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    const occurrences = retryBody.history.filter(
      (m: { content: string }) => m.content === "repeat me",
    ).length;
    expect(occurrences).toBe(1);
  });

  it("retry fires during the local per-question cooldown (bypasses it)", async () => {
    // The first send arms the local 15s cooldown at send-start. A naive retry
    // would be blocked by that cooldown; retry() must bypass it.
    const fetchMock = vi.fn().mockResolvedValue(okResponse("answer"));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAskAi(), { wrapper });
    await act(async () => { await result.current.sendMessage("q"); });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Retry immediately — do NOT advance the clock past the 15s cooldown.
    await act(async () => { result.current.retry(); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("shares one conversation across two consumers of the provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse("shared answer"));
    vi.stubGlobal("fetch", fetchMock);

    // Two independent components (mimicking AiCompanionProvider and AskAiPage)
    // both call useAskAi under a SINGLE AskAiProvider.
    function Consumer({ id }: { id: string }) {
      const { messages, sendMessage } = useAskAi();
      return (
        <div>
          <button onClick={() => sendMessage(`hi from ${id}`)}>send-{id}</button>
          <span data-testid={`count-${id}`}>{messages.length}</span>
          <span data-testid={`last-${id}`}>{messages[messages.length - 1]?.content ?? ""}</span>
        </div>
      );
    }

    render(
      <MemoryRouter>
        <AskAiProvider>
          <Consumer id="a" />
          <Consumer id="b" />
        </AskAiProvider>
      </MemoryRouter>,
    );

    // Both start empty.
    expect(screen.getByTestId("count-a").textContent).toBe("0");
    expect(screen.getByTestId("count-b").textContent).toBe("0");

    // Send from consumer A.
    await act(async () => {
      fireEvent.click(screen.getByText("send-a"));
    });

    // Consumer B (a *different* component instance) must observe the same
    // user + assistant messages — proving the state is shared, not duplicated.
    await waitFor(() => expect(screen.getByTestId("count-b").textContent).toBe("2"));
    expect(screen.getByTestId("count-a").textContent).toBe("2");
    expect(screen.getByTestId("last-a").textContent).toBe("shared answer");
    expect(screen.getByTestId("last-b").textContent).toBe("shared answer");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

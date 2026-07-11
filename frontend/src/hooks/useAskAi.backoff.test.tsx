import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { useAskAi, AskAiProvider } from "./useAskAi";

const STORAGE_KEY = "calsight-ask-ai-messages";
const COOLDOWN_KEY = "calsight-ask-ai-cooldown";

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

function errResponse(status: number, body: Record<string, unknown>): Response {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <AskAiProvider>{children}</AskAiProvider>
  </MemoryRouter>
);

describe("useAskAi — server backoff and session persistence", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("retries 429s and, when exhausted, arms a server backoff that even retry() honors", async () => {
    // Attempts 1+2: fast 429s (tiny retry_after keeps the test quick).
    // Attempt 3: final 429 with a long retry_after → server backoff.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errResponse(429, { retry_after: 0.001 }))
      .mockResolvedValueOnce(errResponse(429, { retry_after: 0.001 }))
      .mockResolvedValueOnce(errResponse(429, { retry_after: 60 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAskAi(), { wrapper });

    const before = Date.now();
    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current.sendMessage("throttled question");
    });

    // All three attempts hit the server; the question stays in history so the
    // user can retry, hence "sent".
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sent).toBe(true);
    expect(result.current.error).toContain("60 seconds");
    expect(result.current.messages).toHaveLength(1); // user msg only, no answer
    // Cooldown extended to the server's retry_after (not the local 15s).
    expect(result.current.cooldownEnd).toBeGreaterThanOrEqual(before + 59_000);

    // retry() bypasses the LOCAL cooldown but must honor the SERVER backoff.
    await act(async () => {
      result.current.retry();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3); // no new request
    expect(result.current.error).toMatch(/wait \d+s/i);

    // A brand-new question is refused as well.
    await act(async () => {
      sent = await result.current.sendMessage("another question");
    });
    expect(sent).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns the providers-busy message and backoff when 503 persists through all retries", async () => {
    // 429s first so the retry loop skips its 3s inter-attempt delay, then a
    // final 503 carrying the server's message + retry_after.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errResponse(429, { retry_after: 0.001 }))
      .mockResolvedValueOnce(errResponse(429, { retry_after: 0.001 }))
      .mockResolvedValueOnce(errResponse(503, { message: "All AI providers are busy right now.", retry_after: 42 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAskAi(), { wrapper });

    const before = Date.now();
    await act(async () => {
      await result.current.sendMessage("busy question");
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBe("All AI providers are busy right now.");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.cooldownEnd).toBeGreaterThanOrEqual(before + 41_000);
    expect(result.current.cooldownEnd).toBeLessThanOrEqual(Date.now() + 42_000);

    // Server backoff blocks an immediate retry.
    await act(async () => {
      result.current.retry();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("recovers when a retry succeeds after a transient 429", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errResponse(429, { retry_after: 0.001 }))
      .mockResolvedValueOnce(okResponse("recovered answer"));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAskAi(), { wrapper });

    await act(async () => {
      await result.current.sendMessage("flaky question");
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1].content).toBe("recovered answer");
  });

  it("retry() re-sends the failed question without duplicating it in history", async () => {
    // Exhaust the internal retries with instantly-expiring 429s so the send
    // fails fast and the server backoff (retry_after 0.001s) lapses before
    // retry() runs; the fourth request then succeeds.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(errResponse(429, { retry_after: 0.001 }))
      .mockResolvedValueOnce(errResponse(429, { retry_after: 0.001 }))
      .mockResolvedValueOnce(errResponse(429, { retry_after: 0.001 }))
      .mockResolvedValueOnce(okResponse("finally an answer"));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAskAi(), { wrapper });

    await act(async () => {
      await result.current.sendMessage("ask me once");
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.error).not.toBeNull();
    expect(result.current.messages).toHaveLength(1); // the failed question

    // Let the 1ms server backoff expire, then retry.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
      result.current.retry();
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    // Exactly one copy of the question in the conversation...
    const userMessages = result.current.messages.filter((m) => m.role === "user");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].content).toBe("ask me once");
    expect(result.current.messages[1].content).toBe("finally an answer");
    expect(result.current.error).toBeNull();

    // ...and exactly one copy in the LLM history the retry request sent.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const retryBody = JSON.parse(fetchMock.mock.calls[3][1].body as string);
    const historyQuestions = (retryBody.history as { role: string; content: string }[])
      .filter((h) => h.role === "user" && h.content === "ask me once");
    expect(historyQuestions).toHaveLength(1);
  });

  it("persists the conversation to sessionStorage and rehydrates it on a fresh mount", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse("stored answer")));

    const first = renderHook(() => useAskAi(), { wrapper });
    await act(async () => {
      await first.result.current.sendMessage("remember me");
    });
    await waitFor(() => expect(first.result.current.messages).toHaveLength(2));
    first.unmount();

    const raw = sessionStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);

    // A brand-new provider instance (page reload within the tab) reloads it.
    const second = renderHook(() => useAskAi(), { wrapper });
    expect(second.result.current.messages).toHaveLength(2);
    expect(second.result.current.messages[0].content).toBe("remember me");
    expect(second.result.current.messages[1].content).toBe("stored answer");
  });

  it("hydrates the cooldown from sessionStorage so a reload cannot bypass it", async () => {
    const future = Date.now() + 60_000;
    sessionStorage.setItem(COOLDOWN_KEY, String(future));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAskAi(), { wrapper });
    expect(result.current.cooldownEnd).toBe(future);

    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current.sendMessage("too soon");
    });
    expect(sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/wait/i);
  });

  it("ignores corrupted sessionStorage instead of crashing", () => {
    sessionStorage.setItem(STORAGE_KEY, "{not json![");
    const { result } = renderHook(() => useAskAi(), { wrapper });
    expect(result.current.messages).toEqual([]);
  });

  it("clearConversation wipes messages, error, cooldown and both storage keys", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse("bye")));

    const { result } = renderHook(() => useAskAi(), { wrapper });
    await act(async () => {
      await result.current.sendMessage("to be cleared");
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(sessionStorage.getItem(COOLDOWN_KEY)).not.toBeNull();

    act(() => {
      result.current.clearConversation();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.cooldownEnd).toBe(0);
    // The messages effect may re-write an empty array after the key removal;
    // either way the persisted conversation must be empty.
    const raw = sessionStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw ?? "[]")).toEqual([]);
    expect(sessionStorage.getItem(COOLDOWN_KEY)).toBeNull();
  });
});

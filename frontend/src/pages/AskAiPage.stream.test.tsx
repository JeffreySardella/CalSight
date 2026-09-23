import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AskAiPage from "./AskAiPage";
import { AskAiProvider } from "../hooks/useAskAi";
import { askPayload, sseFrame } from "../__mocks__/askFetch";

vi.mock("../lib/story/exportCanvas", () => ({
  exportPng: vi.fn(), exportPdf: vi.fn(), defaultFilename: () => "calsight-story-test",
}));

/** A stream the test feeds by hand, so each token can be asserted on. */
function pushableStream() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start: (c) => { controller = c; } });
  return {
    stream,
    push: (text: string) => act(async () => { controller.enqueue(encoder.encode(text)); }),
    close: () => act(async () => { controller.close(); }),
  };
}

async function ask(question: string) {
  render(<MemoryRouter><AskAiProvider><AskAiPage /></AskAiProvider></MemoryRouter>);
  fireEvent.change(screen.getByRole("textbox", { name: /ask a question/i }), {
    target: { value: question },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
  });
}

describe("AskAiPage streaming", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    // jsdom has no layout, so the transcript's auto-scroll needs a stub.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("shows the thinking indicator, then renders tokens as they arrive", async () => {
    const { stream, push, close } = pushableStream();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => null }, body: stream,
    } as unknown as Response));

    await ask("How many crashes in Kern?");

    // Nothing streamed yet — the existing thinking indicator holds the space.
    expect(screen.getByRole("status", { name: /thinking/i })).toBeTruthy();

    await push(sseFrame("token", { t: "Kern County " }));
    await waitFor(() => expect(screen.getByText("Kern County")).toBeTruthy());
    expect(screen.queryByRole("status", { name: /thinking/i })).toBeNull();

    // Second token extends the same bubble rather than adding a message.
    await push(sseFrame("token", { t: "saw 12 crashes." }));
    await waitFor(() => expect(screen.getByText("Kern County saw 12 crashes.")).toBeTruthy());

    // `done` swaps in the processed answer plus its metadata.
    await push(sseFrame("done", askPayload("Kern County saw 12 crashes.", { provider: "Groq" })));
    await close();
    await waitFor(() => expect(screen.getByText(/Powered by Groq/)).toBeTruthy());
    expect(screen.getByText("Kern County saw 12 crashes.")).toBeTruthy();
  });

  it("shows the server's progress lines until the first token", async () => {
    const { stream, push, close } = pushableStream();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => null }, body: stream,
    } as unknown as Response));

    await ask("Is it getting more dangerous to walk in Los Angeles?");

    await push(sseFrame("status", { text: "Choosing what to look up..." }));
    await waitFor(() => expect(screen.getByText("Choosing what to look up...")).toBeTruthy());

    // Each phase replaces the last, inside the same indicator.
    await push(sseFrame("status", { text: "Counting people hurt or killed by travel mode in Los Angeles..." }));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: /thinking/i }).textContent)
        .toContain("travel mode in Los Angeles"),
    );
    expect(screen.queryByText("Choosing what to look up...")).toBeNull();

    // The answer takes over from the indicator.
    await push(sseFrame("token", { t: "Pedestrian deaths rose." }));
    await waitFor(() => expect(screen.getByText("Pedestrian deaths rose.")).toBeTruthy());
    expect(screen.queryByRole("status", { name: /thinking/i })).toBeNull();

    await push(sseFrame("done", askPayload("Pedestrian deaths rose.", { provider: "Groq" })));
    await close();
    await waitFor(() => expect(screen.getByText(/Powered by Groq/)).toBeTruthy());
    expect(screen.queryByText(/travel mode/)).toBeNull();
  });

  it("drops a narrated preamble when the round turns out to be a tool call", async () => {
    const { stream, push, close } = pushableStream();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => null }, body: stream,
    } as unknown as Response));

    await ask("How many crashes in Kern?");

    await push(sseFrame("token", { t: "Let me check the data" }));
    await waitFor(() => expect(screen.getByText("Let me check the data")).toBeTruthy());

    // The backend discards that text server-side; `reset` says so.
    await push(sseFrame("reset", {}));
    await waitFor(() => expect(screen.queryByText("Let me check the data")).toBeNull());
    expect(screen.getByRole("status", { name: /thinking/i })).toBeTruthy();

    await push(sseFrame("token", { t: "Kern County saw 12 crashes." }));
    await waitFor(() => expect(screen.getByText("Kern County saw 12 crashes.")).toBeTruthy());
    await push(sseFrame("done", askPayload("Kern County saw 12 crashes.", { provider: "Groq" })));
    await close();

    await waitFor(() => expect(screen.getByText(/Powered by Groq/)).toBeTruthy());
    expect(screen.queryByText(/Let me check the data/)).toBeNull();
  });

  it("shows the error state when the stream fails after its first token", async () => {
    const { stream, push, close } = pushableStream();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => null }, body: stream,
    } as unknown as Response));

    await ask("How many crashes in Kern?");
    await push(sseFrame("token", { t: "Kern County " }));
    await waitFor(() => expect(screen.getByText("Kern County")).toBeTruthy());

    await push(sseFrame("error", { message: "The AI stream was interrupted. Please try again." }));
    await close();

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("interrupted");
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  it("falls back to the non-streaming endpoint when the stream never starts", async () => {
    const fetchMock = vi.fn(async (url: unknown) =>
      String(url).endsWith("/ask/stream")
        ? ({ ok: false, status: 501, headers: { get: () => null }, json: async () => ({}) } as unknown as Response)
        : ({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => askPayload("Fallback answer.", { provider: "Gemini" }),
          } as unknown as Response),
    );
    vi.stubGlobal("fetch", fetchMock);

    await ask("How many crashes in Kern?");

    await waitFor(() => expect(screen.getByText("Fallback answer.")).toBeTruthy());
    expect(screen.getByText(/Powered by Gemini/)).toBeTruthy();
    expect(fetchMock.mock.calls.map((c) => String(c[0]).replace(/^.*\/api/, "/api"))).toEqual([
      "/api/ask/stream",
      "/api/ask",
    ]);
  });
});

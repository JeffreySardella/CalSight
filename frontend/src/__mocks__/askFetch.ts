import { vi } from "vitest";

/** Body of an SSE `done` event / the JSON endpoint's response. */
export interface AskPayload {
  answer: string;
  provider: string;
  suggestions: string[];
  chart: unknown;
  grounded: boolean;
  filters_used: Record<string, unknown>;
  tools_called: string[];
  cached?: boolean;
}

export function askPayload(answer: string, extra: Partial<AskPayload> = {}): AskPayload {
  return {
    answer,
    provider: "test",
    suggestions: [],
    chart: null,
    grounded: true,
    filters_used: {},
    tools_called: [],
    ...extra,
  };
}

export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A fetch Response whose body streams `chunks` one read() at a time. */
export function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const queue = [...chunks];
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = queue.shift();
        if (next === undefined) controller.close();
        else controller.enqueue(encoder.encode(next));
      },
    }),
  } as unknown as Response;
}

/**
 * Stub global fetch so /api/ask/stream is unavailable and every request falls
 * through to `jsonMock` (the JSON /api/ask endpoint). Lets the pre-streaming
 * test suites keep asserting on `jsonMock` call counts unchanged — they now
 * pin the behaviour of the fallback path.
 */
export function stubJsonOnly(jsonMock: unknown): void {
  const json = jsonMock as (url: unknown, init?: unknown) => Promise<Response>;
  vi.stubGlobal("fetch", (url: unknown, init?: unknown) =>
    String(url).endsWith("/ask/stream")
      ? Promise.resolve({
          ok: false,
          status: 501,
          headers: { get: () => null },
          json: async () => ({}),
        } as unknown as Response)
      : json(url, init),
  );
}

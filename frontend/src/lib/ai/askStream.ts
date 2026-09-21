/**
 * Minimal Server-Sent Events reader for POST /api/ask/stream.
 *
 * EventSource can't POST (and the Ask request body carries the question,
 * filters and history), so the stream is read off fetch's ReadableStream and
 * framed here. Network chunks split anywhere — mid-field, mid-frame — so the
 * parser is stateful and only emits once it has seen a frame's blank line.
 */

export interface SseEvent {
  event: string;
  data: string;
}

/** Stateful SSE framer: feed it decoded text, get back whole events. */
export function createSseParser(): (chunk: string) => SseEvent[] {
  let buffer = "";
  return (chunk: string): SseEvent[] => {
    // CRLF is valid SSE and is what a rewriting intermediary can emit; without
    // this the frame terminator is never found and the reader hangs. Done over
    // the whole buffer so a lone trailing \r normalises on the next chunk.
    buffer = (buffer + chunk).replace(/\r\n/g, "\n");
    const events: SseEvent[] = [];
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end === -1) break;
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length > 0) events.push({ event, data: data.join("\n") });
    }
    return events;
  };
}

/** Yield SSE events from a fetch response body as they arrive. */
export async function* readSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parse = createSseParser();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const event of parse(decoder.decode(value, { stream: true }))) yield event;
  }
}

// The model appends "Chart: {...}" / "Suggested: [...]" trailers that the
// backend strips before it sends the done payload. Hide them while the raw
// text streams in rather than flashing raw JSON at the reader.
// The colon is optional before a bracket because the backend's own strip
// (routers/ask.py) accepts "Suggested [" too.
const TRAILER = /(?:^|\n)[\s-]*\*{0,2}(?:Chart|Suggested)\*{0,2}(?::|\s*[[{])/;
const MARKERS = ["Chart:", "Suggested:"];

/** The part of a partially-streamed answer that is safe to show. */
export function visibleAnswer(raw: string): string {
  const match = TRAILER.exec(raw);
  if (match) return raw.slice(0, match.index).trimEnd();
  // A trailer arrives a token at a time, so until its colon lands the last
  // line reads "---" and then "**Sugges" — the flash this hides. A last line
  // that is only rule/bold marks plus a prefix of a marker is held back; it
  // reappears with the next token if it turns out to be ordinary prose.
  const lineStart = raw.lastIndexOf("\n") + 1;
  const tail = raw.slice(lineStart).replace(/^[\s*-]+/, "");
  const heldBack = MARKERS.some((m) => m.startsWith(tail));
  if (!heldBack) return raw.trimEnd();
  // Drop the "---" rule the model puts above the trailer along with it.
  return raw.slice(0, lineStart).replace(/(?:\n[\s*-]*)+$/, "").trimEnd();
}

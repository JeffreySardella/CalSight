import { describe, it, expect } from "vitest";
import { createSseParser, readSseStream, visibleAnswer } from "./askStream";
import { streamResponse, sseFrame } from "../../__mocks__/askFetch";

describe("createSseParser", () => {
  it("emits one event per frame", () => {
    const parse = createSseParser();
    expect(parse('event: token\ndata: {"t":"a"}\n\nevent: done\ndata: {}\n\n')).toEqual([
      { event: "token", data: '{"t":"a"}' },
      { event: "done", data: "{}" },
    ]);
  });

  it("buffers an event split across chunk boundaries", () => {
    const parse = createSseParser();
    // Network chunks land wherever they land — mid-field name, mid-JSON,
    // between the two newlines that terminate a frame.
    expect(parse("event: to")).toEqual([]);
    expect(parse('ken\ndata: {"t":"Ke')).toEqual([]);
    expect(parse('rn"}\n')).toEqual([]);
    expect(parse("\n")).toEqual([{ event: "token", data: '{"t":"Kern"}' }]);
  });

  it("keeps a partial trailing frame until it completes", () => {
    const parse = createSseParser();
    expect(parse('event: token\ndata: {"t":"a"}\n\nevent: to')).toEqual([
      { event: "token", data: '{"t":"a"}' },
    ]);
    expect(parse('ken\ndata: {"t":"b"}\n\n')).toEqual([{ event: "token", data: '{"t":"b"}' }]);
  });

  it("joins multi-line data fields and tolerates the optional space", () => {
    const parse = createSseParser();
    expect(parse("event: note\ndata: one\ndata:two\n\n")).toEqual([
      { event: "note", data: "one\ntwo" },
    ]);
  });

  it("ignores comment/heartbeat frames that carry no data", () => {
    const parse = createSseParser();
    expect(parse(": keep-alive\n\n")).toEqual([]);
  });
});

describe("readSseStream", () => {
  it("yields events as the body arrives, across arbitrary chunking", async () => {
    const whole = sseFrame("token", { t: "Kern " }) + sseFrame("token", { t: "County" }) + sseFrame("done", { answer: "Kern County" });
    // One character per read: the worst-case chunking a proxy could produce.
    const resp = streamResponse([...whole]);
    const seen: string[] = [];
    for await (const ev of readSseStream(resp.body!)) seen.push(`${ev.event}:${ev.data}`);

    expect(seen).toEqual([
      'token:{"t":"Kern "}',
      'token:{"t":"County"}',
      'done:{"answer":"Kern County"}',
    ]);
  });
});

describe("visibleAnswer", () => {
  it("passes ordinary partial text through", () => {
    expect(visibleAnswer("Kern County saw 41,2")).toBe("Kern County saw 41,2");
  });

  it("hides the chart and suggestion trailers the backend strips", () => {
    expect(visibleAnswer('Kern saw 12 crashes.\n\nChart: {"type": "bar"')).toBe("Kern saw 12 crashes.");
    expect(visibleAnswer('Kern saw 12 crashes.\n\n---\nSuggested: ["More?"]')).toBe("Kern saw 12 crashes.");
    expect(visibleAnswer("Kern saw 12 crashes.\n**Chart:** {")).toBe("Kern saw 12 crashes.");
  });

  it("leaves the word chart alone mid-sentence", () => {
    expect(visibleAnswer("The chart: below shows it")).toBe("The chart: below shows it");
  });
});

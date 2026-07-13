import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  conversationToMarkdown,
  conversationToJson,
  downloadConversation,
} from "./conversation";
import type { ChatMessage } from "../../hooks/useAskAi";

const convo: ChatMessage[] = [
  { role: "user", content: "Which county has the most DUI crashes?", timestamp: 1 },
  {
    role: "assistant",
    content: "Los Angeles leads with the most.",
    timestamp: 2,
    provider: "groq",
    grounded: true,
    cached: false,
    chart: {
      type: "bar",
      title: "Top counties",
      data: [
        { label: "Los Angeles", value: 12345 },
        { label: "San Diego | South", value: 6789 },
        { label: "Kern \\ East", value: 42 },
      ],
    },
  },
];

describe("conversationToMarkdown", () => {
  it("renders user and assistant turns with headings", () => {
    const md = conversationToMarkdown(convo);
    expect(md).toContain("## You");
    expect(md).toContain("Which county has the most DUI crashes?");
    expect(md).toContain("## CalSight AI");
    expect(md).toContain("Los Angeles leads with the most.");
  });

  it("renders the chart as a Markdown table with escaped pipes and grouped numbers", () => {
    const md = conversationToMarkdown(convo);
    expect(md).toContain("**Top counties**");
    expect(md).toContain("| Label | Value |");
    expect(md).toContain("| Los Angeles | 12,345 |");
    // The pipe inside the label is escaped so it can't break the table.
    expect(md).toContain("San Diego \\| South");
    // Backslashes are escaped first, so they can't re-arm an escaped pipe.
    expect(md).toContain("Kern \\\\ East");
  });

  it("includes provider/grounded metadata for assistant turns", () => {
    const md = conversationToMarkdown(convo);
    expect(md).toContain("provider: groq");
    expect(md).toContain("grounded in crash data");
    expect(md).not.toContain("cached");
  });

  it("adds an export timestamp when provided and ends with a single newline", () => {
    const md = conversationToMarkdown(convo, { generatedAt: "2026-07-11 08:30" });
    expect(md).toContain("_Exported 2026-07-11 08:30_");
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });
});

describe("conversationToJson", () => {
  it("is valid JSON with the expected envelope and message projection", () => {
    const parsed = JSON.parse(conversationToJson(convo, { generatedAt: "t" }));
    expect(parsed.app).toBe("CalSight");
    expect(parsed.kind).toBe("ask-ai-conversation");
    expect(parsed.exportedAt).toBe("t");
    expect(parsed.messageCount).toBe(2);
    expect(parsed.messages[0]).toMatchObject({ role: "user", content: convo[0].content });
    expect(parsed.messages[1].chart.data).toHaveLength(3);
  });
});

describe("downloadConversation", () => {
  beforeEach(() => {
    // jsdom lacks these; stub the download plumbing.
    globalThis.URL.createObjectURL = vi.fn(() => "blob:x");
    globalThis.URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns a .md filename for markdown and a .json filename for json", () => {
    expect(downloadConversation(convo, "markdown")).toMatch(/^calsight-conversation-\d{4}-\d{2}-\d{2}\.md$/);
    expect(downloadConversation(convo, "json")).toMatch(/^calsight-conversation-\d{4}-\d{2}-\d{2}\.json$/);
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(2);
  });
});

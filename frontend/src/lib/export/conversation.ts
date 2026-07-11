/** Export an Ask AI conversation as Markdown or JSON (roadmap #256/#293).
 *
 *  Pure serializers plus thin download wrappers. Kept dependency-free and
 *  separate from the UI so the formatting is unit-testable in isolation.
 */
import { triggerDownload, todayStamp } from "./download";
import type { ChatMessage, ChartData } from "../../hooks/useAskAi";

/** A small subset of a chart rendered as a Markdown table, so a downloaded
 *  transcript still carries the numbers even without the SVG. */
function chartToMarkdown(chart: ChartData): string {
  const lines: string[] = [];
  if (chart.title) lines.push(`**${chart.title}**`);
  lines.push("| Label | Value |", "| --- | ---: |");
  for (const row of chart.data) {
    // Escape pipes so a label can't break the table layout.
    const label = String(row.label).replace(/\|/g, "\\|");
    lines.push(`| ${label} | ${row.value.toLocaleString()} |`);
  }
  return lines.join("\n");
}

export function conversationToMarkdown(
  messages: ChatMessage[],
  opts: { title?: string; generatedAt?: string } = {},
): string {
  const title = opts.title ?? "CalSight — Ask AI conversation";
  const out: string[] = [`# ${title}`, ""];
  if (opts.generatedAt) out.push(`_Exported ${opts.generatedAt}_`, "");

  for (const m of messages) {
    if (m.role === "user") {
      out.push("## You", "", m.content.trim(), "");
    } else {
      out.push("## CalSight AI", "", m.content.trim(), "");
      if (m.chart && m.chart.data.length) {
        out.push(chartToMarkdown(m.chart), "");
      }
      const meta: string[] = [];
      if (m.provider) meta.push(`provider: ${m.provider}`);
      if (m.grounded) meta.push("grounded in crash data");
      if (m.cached) meta.push("cached");
      if (meta.length) out.push(`_(${meta.join(" · ")})_`, "");
    }
  }
  // Collapse any trailing blank lines to a single terminating newline.
  return out.join("\n").replace(/\n+$/, "") + "\n";
}

export function conversationToJson(
  messages: ChatMessage[],
  opts: { generatedAt?: string } = {},
): string {
  return JSON.stringify(
    {
      app: "CalSight",
      kind: "ask-ai-conversation",
      exportedAt: opts.generatedAt ?? null,
      messageCount: messages.length,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        provider: m.provider,
        grounded: m.grounded,
        cached: m.cached,
        toolsCalled: m.toolsCalled,
        chart: m.chart,
      })),
    },
    null,
    2,
  );
}

export type ConversationExportFormat = "markdown" | "json";

/** Serialize + trigger a browser download. Returns the filename used. */
export function downloadConversation(
  messages: ChatMessage[],
  format: ConversationExportFormat,
  generatedAt?: string,
): string {
  const stamp = todayStamp();
  if (format === "markdown") {
    const md = conversationToMarkdown(messages, { generatedAt });
    const filename = `calsight-conversation-${stamp}.md`;
    triggerDownload(new Blob([md], { type: "text/markdown;charset=utf-8" }), filename);
    return filename;
  }
  const json = conversationToJson(messages, { generatedAt });
  const filename = `calsight-conversation-${stamp}.json`;
  triggerDownload(new Blob([json], { type: "application/json;charset=utf-8" }), filename);
  return filename;
}

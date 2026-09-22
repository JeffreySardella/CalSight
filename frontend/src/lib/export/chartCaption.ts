/**
 * Caption composition for exported chart PNGs.
 *
 * A chart PNG shared on its own (Slack, a report, a tweet) loses everything
 * the on-screen card carries around it: the footnote asterisk, the active
 * filters, and whose data this even is. This module composes those into an
 * ordered list of caption lines; chartExport.ts wraps/measures/draws them
 * onto the export canvas. Kept pure (no canvas) so composition is testable
 * without mocking a 2D context.
 */

export const CAPTION_ATTRIBUTION = "CalSight · calsight.org · data: SWITRS/CCRS";

export type CaptionLineKind = "title" | "filter" | "footnote" | "attribution";

export interface CaptionLine {
  text: string;
  kind: CaptionLineKind;
}

export interface ChartCaptionInput {
  /** Chart title exactly as shown on screen (already includes "People by …" wording, trailing "*", etc). */
  title: string;
  /** Active-filter one-liner (e.g. FilterScope.oneLine). Omit or pass null/"" when unfiltered — no line is added. */
  filterSummary?: string | null;
  /** Footnote(s) shown under the chart on screen, verbatim. Falsy entries are skipped. */
  footnotes?: (string | null | undefined)[];
}

/**
 * Ordered caption lines: title, filter summary (if any), footnotes verbatim
 * (if any) in the order given, then the fixed attribution line — always
 * last, always present.
 */
export function buildCaptionLines(input: ChartCaptionInput): CaptionLine[] {
  const lines: CaptionLine[] = [{ text: input.title, kind: "title" }];
  if (input.filterSummary) {
    lines.push({ text: input.filterSummary, kind: "filter" });
  }
  for (const note of input.footnotes ?? []) {
    if (note) lines.push({ text: note, kind: "footnote" });
  }
  lines.push({ text: CAPTION_ATTRIBUTION, kind: "attribution" });
  return lines;
}

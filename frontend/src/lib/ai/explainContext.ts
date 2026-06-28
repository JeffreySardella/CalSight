import type { DataContext } from "./dataContext";
import { statNarrative, type DistributionPoint } from "./statNarrative";

export type Explanation = { headline: string; body: string };

export function explainContext(
  ctx: DataContext,
  deps?: { distribution?: DistributionPoint[] },
): Explanation {
  if (ctx.kind === "stat" && ctx.value != null && deps?.distribution?.length) {
    const subjectId = ctx.geography?.id ?? "__subject__";
    const n = statNarrative({
      label: ctx.label, value: ctx.value, subjectId,
      distribution: deps.distribution,
    });
    return { headline: ctx.label, body: n.paragraph };
  }

  if (ctx.kind === "chart" && ctx.series?.length) {
    const peak = ctx.series.reduce((a, b) => (b.value > a.value ? b : a));
    const total = ctx.series.reduce((sum, p) => sum + p.value, 0);
    return {
      headline: ctx.label,
      body: `Peaks at ${peak.label} (${peak.value.toLocaleString()}), out of ${total.toLocaleString()} total.`,
    };
  }

  return { headline: ctx.label, body: `Select "Go deeper with AI" to analyze ${ctx.label}.` };
}

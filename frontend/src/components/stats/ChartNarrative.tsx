import { useState } from "react";
import type { ChartNarrativeResult } from "../../hooks/useNarrativeInsights";

interface Props {
  narrative: ChartNarrativeResult | null;
}

/**
 * Renders an auto-generated narrative paragraph beneath a chart.
 * Shows a collapsed preview by default and expands on click.
 *
 * Usage inside ChartCard:
 * ```tsx
 * <ChartNarrative narrative={getChartNarrative(slot.id)} />
 * ```
 */
export default function ChartNarrative({ narrative }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (!narrative || narrative.confidence === 0) return null;

  const hasMore = narrative.sentences.length > 1;
  const preview = hasMore && !expanded
    ? narrative.sentences[0]
    : narrative.paragraph;

  return (
    <div className="mt-3 pt-3 border-t border-outline-variant/20">
      <div className="flex items-start gap-2">
        <span
          className="material-symbols-outlined text-[14px] mt-0.5 flex-shrink-0 text-on-surface-variant"
          aria-hidden="true"
        >
          auto_awesome
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-on-surface-variant leading-relaxed">
            {preview}
            {hasMore && !expanded && "..."}
          </p>
          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="text-primary text-[10px] font-bold uppercase tracking-wider hover:underline mt-1 min-h-[44px] min-w-[44px] flex items-center"
            >
              {expanded ? "Less" : "More"}
            </button>
          )}

        </div>
      </div>
    </div>
  );
}

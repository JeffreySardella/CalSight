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

  const hasMultipleSentences = narrative.sentences.length > 2;
  const preview = hasMultipleSentences && !expanded
    ? narrative.sentences.slice(0, 2).join(" ")
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
            {hasMultipleSentences && !expanded && "..."}
          </p>
          {hasMultipleSentences && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="text-primary text-[10px] font-bold uppercase tracking-wider hover:underline mt-1"
            >
              {expanded ? "Less" : "More"}
            </button>
          )}

          {/* Statistical fact badges (shown when expanded) */}
          {expanded && narrative.facts.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {narrative.facts.slice(0, 4).map((fact, idx) => (
                <span
                  key={idx}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold ${
                    fact.strength === "strong"
                      ? "bg-error/10 text-error"
                      : fact.strength === "moderate"
                        ? "bg-tertiary/10 text-tertiary"
                        : "bg-surface-container-high text-on-surface-variant"
                  }`}
                >
                  {fact.type === "peak" && "Peak"}
                  {fact.type === "trough" && "Trough"}
                  {fact.type === "trend" && "Trend"}
                  {fact.type === "concentration" && "Concentrated"}
                  {fact.type === "dominance" && "Dominant"}
                  {fact.type === "comparison" && "Comparison"}
                  {fact.type === "volatility" && "Volatile"}
                  {fact.type === "outlier" && "Outlier"}
                  {fact.type === "change_point" && "Shift"}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

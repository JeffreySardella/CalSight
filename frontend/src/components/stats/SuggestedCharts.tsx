import { useState } from "react";
import type { ChartSuggestion } from "../../hooks/useChartSuggestions";
import type { ChartType, Dimension, Measure } from "../../lib/dashboard/types";

interface Props {
  suggestions: ChartSuggestion[];
  onAdd: (chart: { dimension: Dimension; measure: Measure; chartType: ChartType }) => void;
}

export default function SuggestedCharts({ suggestions, onAdd }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  if (suggestions.length === 0) return null;

  const visible = suggestions.filter((s) => !dismissed.has(s.id));
  if (visible.length === 0) return null;

  const displayed = expanded ? visible.slice(0, 6) : visible.slice(0, 3);

  return (
    <section className="bg-surface-container-lowest rounded-2xl p-4 sm:p-5 ambient-shadow space-y-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-3 w-full text-left"
      >
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-primary text-[18px]" aria-hidden="true">auto_awesome</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-headline font-bold text-on-surface">Suggested Charts</h3>
          <p className="text-[10px] text-on-surface-variant">
            {visible.length} recommendation{visible.length !== 1 ? "s" : ""} based on your dashboard
          </p>
        </div>
        <span className="material-symbols-outlined text-on-surface-variant text-[20px] transition-transform" style={{ transform: expanded ? "rotate(180deg)" : undefined }}>
          expand_more
        </span>
      </button>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {displayed.map((suggestion) => (
          <div
            key={suggestion.id}
            className="flex items-start gap-2.5 p-3 rounded-lg border border-outline-variant/20 bg-surface-container-low hover:bg-surface-container transition-colors group"
          >
            <span className="material-symbols-outlined text-primary/70 text-[20px] mt-0.5 flex-shrink-0" aria-hidden="true">
              {suggestion.icon}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] sm:text-xs font-medium text-on-surface leading-snug truncate">
                {suggestion.title}
              </p>
              <p className="text-[9px] sm:text-[10px] text-on-surface-variant mt-0.5 leading-relaxed line-clamp-2">
                {suggestion.explanation}
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                <button
                  type="button"
                  onClick={() => onAdd({
                    dimension: suggestion.dimension,
                    measure: suggestion.measure,
                    chartType: suggestion.chartType,
                  })}
                  className="inline-flex items-center gap-0.5 text-[10px] font-bold text-primary uppercase tracking-wider hover:underline"
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">add</span>
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setDismissed((prev) => new Set([...prev, suggestion.id]))}
                  className="inline-flex items-center gap-0.5 text-[10px] text-on-surface-variant uppercase tracking-wider hover:text-on-surface opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">close</span>
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {visible.length > 3 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-primary text-xs font-bold uppercase tracking-wider hover:underline"
        >
          Show {visible.length - 3} More
        </button>
      )}
    </section>
  );
}

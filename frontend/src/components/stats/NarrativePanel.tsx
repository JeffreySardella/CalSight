import { useState } from "react";
import type { DashboardNarrative, NarrativeTone } from "../../hooks/useNarrativeInsights";

interface Props {
  narrative: DashboardNarrative;
  tone: NarrativeTone;
  onToneChange: (tone: NarrativeTone) => void;
}

const ICON_MAP: Record<string, string> = {
  trending_up: "trending_up",
  trending_down: "trending_down",
  warning: "warning",
  insights: "insights",
  analytics: "analytics",
};

export default function NarrativePanel({ narrative, tone, onToneChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { keyFindings, filterContext, dataNote } = narrative;

  if (keyFindings.length === 0) return null;

  const displayed = expanded ? keyFindings : keyFindings.slice(0, 3);

  return (
    <section
      className="bg-surface-container-lowest rounded-2xl p-4 sm:p-5 ambient-shadow space-y-3"
      aria-label="Key findings"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-primary text-[18px]" aria-hidden="true">
              description
            </span>
          </div>
          <div>
            <h3 className="text-sm font-headline font-bold text-on-surface">Key Findings</h3>
            <p className="text-[10px] text-on-surface-variant">{filterContext}</p>
          </div>
        </div>

        {/* Tone toggle */}
        <div className="flex items-center gap-1 bg-surface-container rounded-full p-0.5">
          <button
            type="button"
            onClick={() => onToneChange("plain")}
            className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-colors ${
              tone === "plain"
                ? "bg-primary text-on-primary"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
            aria-label="Plain language"
            title="Plain language"
          >
            Simple
          </button>
          <button
            type="button"
            onClick={() => onToneChange("technical")}
            className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-colors ${
              tone === "technical"
                ? "bg-primary text-on-primary"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
            aria-label="Technical language"
            title="Statistical language"
          >
            Technical
          </button>
        </div>
      </div>

      {/* Data quality note */}
      {dataNote && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-tertiary/5 border border-tertiary/20">
          <span className="material-symbols-outlined text-tertiary text-[14px] mt-0.5" aria-hidden="true">info</span>
          <p className="text-[11px] text-on-surface-variant">{dataNote}</p>
        </div>
      )}

      {/* Findings list */}
      <ul className="space-y-2" role="list">
        {displayed.map((finding, idx) => (
          <li
            key={`${finding.sourceChart}-${idx}`}
            className="flex items-start gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg bg-surface-container-low"
          >
            <span
              className="material-symbols-outlined text-[16px] mt-0.5 flex-shrink-0 text-primary"
              aria-hidden="true"
            >
              {ICON_MAP[finding.icon] ?? "insights"}
            </span>
            <p className="text-[11px] sm:text-xs font-medium text-on-surface leading-relaxed">
              {finding.text}
            </p>
          </li>
        ))}
      </ul>

      {/* Expand/collapse */}
      {keyFindings.length > 3 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-primary text-xs font-bold uppercase tracking-wider hover:underline"
        >
          {expanded ? "Show Less" : `Show All ${keyFindings.length}`}
        </button>
      )}
    </section>
  );
}

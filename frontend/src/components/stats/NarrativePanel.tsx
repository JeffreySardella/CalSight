import { useState } from "react";
import type { DashboardNarrative, NarrativeTone } from "../../hooks/useNarrativeInsights";
import type { KeyFinding } from "../../lib/dashboard/narrativeEngine";

interface Props {
  narrative: DashboardNarrative;
  tone: NarrativeTone;
  onToneChange: (tone: NarrativeTone) => void;
  defaultCollapsed?: boolean;
}

const ICON_MAP: Record<string, string> = {
  trending_up: "trending_up",
  trending_down: "trending_down",
  warning: "warning",
  insights: "insights",
  analytics: "analytics",
};

export default function NarrativePanel({ narrative, tone, onToneChange, defaultCollapsed = false }: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [expanded, setExpanded] = useState(false);
  const { keyFindings, filterContext, dataNote } = narrative;

  if (keyFindings.length === 0) return null;

  const displayed = expanded ? keyFindings : keyFindings.slice(0, 3);

  return (
    <section
      className="bg-surface-container-lowest rounded-2xl p-4 sm:p-5 ambient-shadow space-y-3"
      aria-label="Key findings"
    >
      {/* Header — clickable to collapse/expand */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-3 min-w-0 text-left min-h-[44px]"
          aria-expanded={!collapsed}
        >
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-primary text-[18px]" aria-hidden="true">
              description
            </span>
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-headline font-bold text-on-surface">Key Findings</h2>
            <p className="text-[11px] text-on-surface-variant truncate">{filterContext}</p>
          </div>
          <span className="flex items-center gap-1.5 flex-shrink-0">
            {collapsed && (
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold">
                {keyFindings.length}
              </span>
            )}
            <span className="material-symbols-outlined text-on-surface-variant text-[20px] transition-transform" style={{ transform: collapsed ? undefined : "rotate(180deg)" }}>
              expand_more
            </span>
          </span>
        </button>

        {/* Tone toggle — only visible when expanded */}
        {!collapsed && (
          <div className="flex items-center gap-1 bg-surface-container rounded-full p-0.5 flex-shrink-0">
            <button
              type="button"
              onClick={() => onToneChange("plain")}
              className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors min-h-[32px] flex items-center justify-center ${
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
              className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors min-h-[32px] flex items-center justify-center ${
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
        )}
      </div>

      {!collapsed && (
        <>
          {/* Data quality note */}
          {dataNote && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-tertiary/5 border border-tertiary/20 min-w-0">
              <span className="material-symbols-outlined text-tertiary text-[14px] mt-0.5 flex-shrink-0" aria-hidden="true">info</span>
              <p className="text-[11px] text-on-surface-variant break-words min-w-0">{dataNote}</p>
            </div>
          )}

          {/* Findings list */}
          <ul className="space-y-2">
            {displayed.map((finding: KeyFinding, idx: number) => (
              <li
                key={`${finding.sourceChart}-${idx}`}
                className="flex items-start gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg bg-surface-container-low min-w-0"
              >
                <span
                  className="material-symbols-outlined text-[16px] mt-0.5 flex-shrink-0 text-primary"
                  aria-hidden="true"
                >
                  {ICON_MAP[finding.icon] ?? "insights"}
                </span>
                <p className="text-[11px] sm:text-xs font-medium text-on-surface leading-relaxed break-words min-w-0">
                  {finding.text}
                </p>
              </li>
            ))}
          </ul>

          {/* Expand/collapse items */}
          {keyFindings.length > 3 && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="text-primary text-xs font-bold uppercase tracking-wider hover:underline min-h-[44px] flex items-center"
            >
              {expanded ? "Show Less" : `Show All ${keyFindings.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

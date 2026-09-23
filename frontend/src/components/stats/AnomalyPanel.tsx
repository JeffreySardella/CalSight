import { useState } from "react";
import type { Anomaly, AnomalySeverity } from "../../lib/dashboard/anomaly";

interface Props {
  anomalies: Anomaly[];
  defaultCollapsed?: boolean;
}

const SEVERITY_BG: Record<AnomalySeverity, string> = {
  critical: "bg-error/10 border-error/30",
  high: "bg-tertiary/10 border-tertiary/30",
  medium: "bg-surface-container-high border-outline-variant/30",
};

const SEVERITY_COLOR: Record<AnomalySeverity, string> = {
  critical: "text-error",
  high: "text-tertiary",
  medium: "text-on-surface-variant",
};

const SEVERITY_ICON: Record<AnomalySeverity, string> = {
  critical: "warning",
  high: "info",
  medium: "lightbulb",
};

const METHOD_LABEL: Record<string, string> = {
  zscore: "Statistical Outlier",
  iqr: "Distribution Outlier",
  change_point: "Structural Shift",
};

export default function AnomalyPanel({ anomalies, defaultCollapsed = false }: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [expanded, setExpanded] = useState(false);
  if (anomalies.length === 0) return null;

  const significant = anomalies.filter(a => a.severity === "critical" || a.severity === "high").length;
  const displayed = expanded ? anomalies : anomalies.slice(0, 3);

  return (
    <section className="bg-surface-container-lowest rounded-2xl p-4 sm:p-5 ambient-shadow space-y-3">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-3 w-full text-left min-h-[44px]"
        aria-expanded={!collapsed}
      >
        <div className="w-8 h-8 rounded-full bg-error/10 flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-error text-[18px]" aria-hidden="true">monitoring</span>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-headline font-bold text-on-surface">Anomaly Detection</h2>
          {/* Leads with the same count as the badge and the "Show All" list;
              it used to say "3 significant" beside a badge of 4. */}
          <p className="text-[11px] text-on-surface-variant">
            {`${anomalies.length} pattern${anomalies.length > 1 ? "s" : ""} detected`}
            {significant > 0 && `, ${significant} significant`}
          </p>
        </div>
        <span className="flex items-center gap-1.5 flex-shrink-0">
          {/* axe: color-contrast — text-error on bg-error/15 was ~3.8:1 on the
              page's white base, below the 4.5:1 AA floor. The error-container
              pair is tuned for this on-tint use and clears 4.5:1 in both themes. */}
          {collapsed && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-error-container text-on-error-container text-[10px] font-bold">
              {anomalies.length}
            </span>
          )}
          <span className="material-symbols-outlined text-on-surface-variant text-[20px] transition-transform" style={{ transform: collapsed ? undefined : "rotate(180deg)" }}>
            expand_more
          </span>
        </span>
      </button>

      {!collapsed && (
        <>
          <div className="space-y-2">
            {displayed.map((a) => (
              <div key={a.id} className={`flex items-start gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg border ${SEVERITY_BG[a.severity]}`}>
                <span className={`material-symbols-outlined text-[14px] sm:text-[16px] mt-0.5 flex-shrink-0 ${SEVERITY_COLOR[a.severity]}`} aria-hidden="true">
                  {SEVERITY_ICON[a.severity]}
                </span>
                <div className="flex-1 min-w-0 overflow-hidden">
                  <p className="text-[11px] sm:text-xs font-medium text-on-surface leading-relaxed break-words">{a.message}</p>
                  <div className="flex items-center gap-2 sm:gap-3 mt-0.5 sm:mt-1">
                    <span className="text-[9px] sm:text-[10px] text-on-surface-variant font-medium">{METHOD_LABEL[a.method]}</span>
                    <span className="text-[9px] sm:text-[10px] text-on-surface-variant">{a.confidence}%</span>
                  </div>
                </div>
                <div className="flex-shrink-0 w-12 sm:w-14 mt-1.5">
                  <div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${a.severity === "critical" ? "bg-error" : a.severity === "high" ? "bg-tertiary" : "bg-primary"}`} style={{ width: `${a.confidence}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {anomalies.length > 3 && (
            <button type="button" onClick={() => setExpanded(!expanded)} className="text-primary text-xs font-bold uppercase tracking-wider hover:underline min-h-[44px] flex items-center">
              {expanded ? "Show Less" : `Show All ${anomalies.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

import { useState } from "react";
import type { Anomaly, AnomalySeverity } from "../../lib/dashboard/anomaly";

interface Props {
  anomalies: Anomaly[];
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

export default function AnomalyPanel({ anomalies }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (anomalies.length === 0) return null;

  const significant = anomalies.filter(a => a.severity === "critical" || a.severity === "high").length;
  const displayed = expanded ? anomalies : anomalies.slice(0, 3);

  return (
    <section className="bg-surface-container-lowest rounded-2xl p-4 sm:p-5 ambient-shadow space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-error/10 flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-error text-[18px]" aria-hidden="true">monitoring</span>
        </div>
        <div>
          <h3 className="text-sm font-headline font-bold text-on-surface">Anomaly Detection</h3>
          <p className="text-[10px] text-on-surface-variant">
            {significant > 0
              ? `${significant} significant pattern${significant > 1 ? "s" : ""} detected`
              : `${anomalies.length} pattern${anomalies.length > 1 ? "s" : ""} of interest`}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {displayed.map((a) => (
          <div key={a.id} className={`flex items-start gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg border ${SEVERITY_BG[a.severity]}`}>
            <span className={`material-symbols-outlined text-[14px] sm:text-[16px] mt-0.5 flex-shrink-0 ${SEVERITY_COLOR[a.severity]}`} aria-hidden="true">
              {SEVERITY_ICON[a.severity]}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] sm:text-xs font-medium text-on-surface leading-relaxed">{a.message}</p>
              <div className="flex items-center gap-2 sm:gap-3 mt-0.5 sm:mt-1">
                <span className="text-[9px] sm:text-[10px] text-on-surface-variant font-medium">{METHOD_LABEL[a.method]}</span>
                <span className="text-[9px] sm:text-[10px] text-on-surface-variant">{a.confidence}%</span>
              </div>
            </div>
            <div className="flex-shrink-0 w-10 sm:w-12 mt-1">
              <div className="w-full h-1 bg-surface-container-highest rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${a.severity === "critical" ? "bg-error" : a.severity === "high" ? "bg-tertiary" : "bg-primary"}`} style={{ width: `${a.confidence}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {anomalies.length > 3 && (
        <button type="button" onClick={() => setExpanded(!expanded)} className="text-primary text-xs font-bold uppercase tracking-wider hover:underline">
          {expanded ? "Show Less" : `Show All ${anomalies.length}`}
        </button>
      )}
    </section>
  );
}

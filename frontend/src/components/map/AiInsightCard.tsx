import { useState } from "react";
import type { ChoroplethPoint } from "../../hooks/useChoroplethData";

interface AiInsightCardProps {
  onClose: () => void;
  countyName: string;
  data: ChoroplethPoint | undefined;
  measureLabel: string;
  compareMode: boolean;
  onCompare: () => void;
  compareCountyName?: string;
  compareData?: ChoroplethPoint;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtMeasure(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function pctDiff(a: number, b: number): string | null {
  if (a === 0 && b === 0) return null;
  if (a === 0) return null;
  const diff = ((b - a) / a) * 100;
  const sign = diff > 0 ? "+" : "";
  return `${sign}${diff.toFixed(1)}%`;
}

function measureValue(data: ChoroplethPoint): string {
  return data.hasEnoughData && data.value != null
    ? fmtMeasure(data.value)
    : "N/A";
}

function MetricGrid({ data, measureLabel }: { data: ChoroplethPoint; measureLabel: string }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      <MetricCell label="Crashes" value={fmt(data.rawCount)} />
      <MetricCell label="Killed" value={fmt(data.totalKilled)} />
      <MetricCell label="Injured" value={fmt(data.totalInjured)} />
      <MetricCell label={measureLabel} value={measureValue(data)} />
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-container-low/50 p-2 rounded-lg">
      <p className="text-[8px] text-on-surface-variant font-bold uppercase tracking-widest mb-0.5">
        {label}
      </p>
      <p className="text-sm font-bold text-on-surface">{value}</p>
    </div>
  );
}

function CompareRow({ label, aVal, bVal, isMeasure }: { label: string; aVal: number | null; bVal: number | null; isMeasure?: boolean }) {
  const f = isMeasure ? fmtMeasure : fmt;
  const aStr = aVal != null ? f(aVal) : "N/A";
  const bStr = bVal != null ? f(bVal) : "N/A";
  const diff = aVal != null && bVal != null ? pctDiff(aVal, bVal) : null;

  return (
    <div className="flex items-baseline justify-between gap-2 bg-surface-container-low/50 px-3 py-2 rounded-lg">
      <span className="text-[8px] text-on-surface-variant font-bold uppercase tracking-widest w-16 shrink-0">{label}</span>
      <span className="text-sm font-bold text-on-surface">{aStr}</span>
      {diff && (
        <span className={`text-[10px] font-semibold ${diff.startsWith("+") ? "text-error" : "text-tertiary"}`}>
          {diff}
        </span>
      )}
      <span className="text-sm font-bold text-on-surface">{bStr}</span>
    </div>
  );
}

export default function AiInsightCard({
  onClose,
  countyName,
  data,
  measureLabel,
  compareMode,
  onCompare,
  compareCountyName,
  compareData,
}: AiInsightCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isComparing = compareMode && compareCountyName && compareData;

  return (
    <div className="absolute bottom-0 left-0 right-0 z-30 md:bottom-2 md:left-16 md:right-2">
      <div className="bg-surface-container-lowest/95 backdrop-blur-md ghost-border md:rounded-xl overflow-hidden">
        {/* Collapsed bar — always visible */}
        <div
          className="flex items-center justify-between px-4 py-2.5 cursor-pointer select-none"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="flex items-center gap-3 min-w-0">
            <h3 className="font-headline text-sm font-bold text-on-surface tracking-tight truncate">
              {isComparing ? `${countyName} vs ${compareCountyName}` : `${countyName} County`}
            </h3>
            {data && !expanded && (
              <span className="text-xs text-on-surface-variant hidden sm:inline">
                {fmt(data.rawCount)} crashes · {fmt(data.totalKilled)} killed
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant transition-transform" style={{ transform: expanded ? "rotate(180deg)" : undefined }}>
              expand_less
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className="p-1 hover:bg-surface-container rounded-full text-on-surface-variant transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        </div>

        {/* Expanded content */}
        {expanded && (
          <div className="px-4 pb-4 space-y-3">
            {isComparing && data ? (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="font-headline text-sm font-bold text-on-surface tracking-tight">{countyName}</h3>
                  <span className="text-[10px] text-on-surface-variant">vs</span>
                  <h3 className="font-headline text-sm font-bold text-on-surface tracking-tight">{compareCountyName}</h3>
                </div>
                <div className="flex flex-col gap-1.5">
                  <CompareRow label="Crashes" aVal={data.rawCount} bVal={compareData.rawCount} />
                  <CompareRow label="Killed" aVal={data.totalKilled} bVal={compareData.totalKilled} />
                  <CompareRow label="Injured" aVal={data.totalInjured} bVal={compareData.totalInjured} />
                  <CompareRow
                    label={measureLabel}
                    aVal={data.hasEnoughData ? data.value : null}
                    bVal={compareData.hasEnoughData ? compareData.value : null}
                    isMeasure
                  />
                </div>
              </>
            ) : (
              <>
                {data && <MetricGrid data={data} measureLabel={measureLabel} />}

                {compareMode && !compareCountyName && (
                  <p className="text-xs text-on-surface-variant text-center py-1">
                    Click a county to compare
                  </p>
                )}

                {!compareMode && (
                  <button
                    onClick={onCompare}
                    className="w-full bg-primary-container text-on-primary-container py-2 rounded-lg text-[11px] font-bold tracking-widest uppercase hover:opacity-90 transition-opacity"
                  >
                    Compare
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

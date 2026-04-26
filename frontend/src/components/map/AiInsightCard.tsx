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
    <div className="grid grid-cols-2 gap-3 md:gap-4 py-1 md:py-2">
      <MetricCell label="Total Crashes" value={fmt(data.rawCount)} />
      <MetricCell label="Killed" value={fmt(data.totalKilled)} />
      <MetricCell label="Injured" value={fmt(data.totalInjured)} />
      <MetricCell label={measureLabel} value={measureValue(data)} />
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-container-low/50 p-2 md:p-3 rounded-lg">
      <p className="text-[8px] md:text-[9px] text-on-surface-variant font-bold uppercase tracking-widest mb-0.5 md:mb-1">
        {label}
      </p>
      <p className="text-base md:text-lg font-bold text-on-surface">{value}</p>
    </div>
  );
}

function CompareRow({ label, aVal, bVal, isMeasure }: { label: string; aVal: number | null; bVal: number | null; isMeasure?: boolean }) {
  const f = isMeasure ? fmtMeasure : fmt;
  const aStr = aVal != null ? f(aVal) : "N/A";
  const bStr = bVal != null ? f(bVal) : "N/A";
  const diff = aVal != null && bVal != null ? pctDiff(aVal, bVal) : null;

  return (
    <div className="bg-surface-container-low/50 p-2 md:p-3 rounded-lg">
      <p className="text-[8px] md:text-[9px] text-on-surface-variant font-bold uppercase tracking-widest mb-1 md:mb-2">
        {label}
      </p>
      <div className="flex items-baseline justify-between gap-1 md:gap-2">
        <span className="text-base md:text-lg font-bold text-on-surface">{aStr}</span>
        {diff && (
          <span className={`text-[10px] md:text-xs font-semibold ${diff.startsWith("+") ? "text-error" : "text-tertiary"}`}>
            {diff}
          </span>
        )}
        <span className="text-base md:text-lg font-bold text-on-surface">{bStr}</span>
      </div>
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
  const isComparing = compareMode && compareCountyName && compareData;

  return (
    <div className={`fixed bottom-14 left-2 right-2 max-h-[55vh] overflow-y-auto md:max-h-none md:overflow-visible md:absolute md:bottom-auto md:left-auto md:right-[10%] md:top-[25%] z-30 ${isComparing ? "md:w-[420px]" : "md:w-[340px]"} bg-surface-container-lowest/90 backdrop-blur-md p-4 md:p-6 rounded-xl ambient-shadow ghost-border flex flex-col gap-2 md:gap-4`}>
      <div className="flex justify-end items-start">
        <button
          onClick={onClose}
          className="p-1 hover:bg-surface-container rounded-full text-on-surface-variant transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      {isComparing && data ? (
        <>
          <div className="flex items-center justify-between">
            <h3 className="font-headline text-sm md:text-base font-bold text-on-surface tracking-tight">{countyName}</h3>
            <span className="text-[10px] md:text-xs text-on-surface-variant">vs</span>
            <h3 className="font-headline text-sm md:text-base font-bold text-on-surface tracking-tight">{compareCountyName}</h3>
          </div>
          <div className="flex flex-col gap-2 md:gap-3">
            <CompareRow label="Total Crashes" aVal={data.rawCount} bVal={compareData.rawCount} />
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
          <div className="space-y-1">
            <h3 className="font-headline text-xl md:text-2xl font-bold text-on-surface tracking-tight leading-tight">
              {countyName} County
            </h3>
          </div>

          {data && <MetricGrid data={data} measureLabel={measureLabel} />}

          {compareMode && !compareCountyName && (
            <p className="text-xs md:text-sm text-on-surface-variant text-center py-1 md:py-2">
              Click a county to compare
            </p>
          )}

          {!compareMode && (
            <button
              onClick={onCompare}
              className="w-full bg-primary-container text-on-primary-container py-2 md:py-3 rounded-lg text-[11px] font-bold tracking-widest uppercase hover:opacity-90 transition-opacity"
            >
              Compare
            </button>
          )}
        </>
      )}
    </div>
  );
}

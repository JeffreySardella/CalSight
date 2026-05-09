import { useState } from "react";
import type { ChoroplethPoint } from "../../hooks/useChoroplethData";
import { Skeleton } from "../ui/Skeleton";

interface AiInsightCardProps {
  onClose: () => void;
  countyName: string;
  data: ChoroplethPoint | undefined;
  measureLabel: string;
  compareMode: boolean;
  onCompare: () => void;
  compareCountyName?: string;
  compareData?: ChoroplethPoint;
  /** LLM-generated narrative blurb. null/undefined = section hidden. */
  narrative?: string | null;
  /** Angle label for the insight card (e.g. "overview", "dui"). */
  narrativeAngle?: string | null;
  /** Callback to fetch a different random insight card. */
  onRefreshNarrative?: () => void;
  /** True while choropleth data is still fetching — show skeletons in place of metric cells. */
  loading?: boolean;
}

function SkeletonMetricGrid() {
  return (
    <div className="grid grid-cols-4 gap-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-surface-container-low/50 p-2.5 rounded-lg">
          <Skeleton className="h-2 w-12 mb-1.5" />
          <Skeleton className="h-4 w-10" />
        </div>
      ))}
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 100_000) return `${(n / 1_000).toFixed(0)}K`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

function fmtMeasure(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 100_000) return `${(n / 1_000).toFixed(0)}K`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
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
    <div className="grid grid-cols-2 gap-2">
      <MetricCell label="Crashes" value={fmt(data.rawCount)} />
      <MetricCell label={measureLabel} value={measureValue(data)} />
      <MetricCell label="Killed" value={fmt(data.totalKilled)} />
      <MetricCell label="Injured" value={fmt(data.totalInjured)} />
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  const textSize = value.length > 6 ? "text-xs" : value.length > 4 ? "text-sm" : "text-base";
  return (
    <div className="bg-surface-container-low/50 p-2.5 rounded-lg min-w-0">
      <p className="text-[8px] text-on-surface-variant font-bold uppercase tracking-wider mb-1 leading-tight" style={{ wordBreak: "break-word" }}>
        {label}
      </p>
      <p className={`${textSize} font-bold text-on-surface truncate`}>{value}</p>
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

const ANGLE_LABELS: Record<string, string> = {
  overview: "Overview",
  dui: "DUI Trends",
  cause_focus: "Top Causes",
  trend: "Trend Analysis",
  comparison: "Comparison",
  unique_factor: "Notable Factor",
  safety_ranking: "Safety Ranking",
  fun_fact: "Fun Fact",
  fun_fact_timing: "Fun Fact",
  fun_fact_comparison: "Fun Fact",
  fun_fact_quirky: "Fun Fact",
  fun_fact_records: "Fun Fact",
  fun_fact_surprising: "Fun Fact",
  geography: "Geography",
  weather: "Weather",
  highway: "Highway",
  commuter: "Commuter",
  ems_response: "EMS",
  economic: "Economic",
  infrastructure: "Infrastructure",
  seasonal: "Seasonal",
  pedestrian: "Pedestrian",
  tourism: "Tourism",
  nighttime: "Nighttime",
  wildlife: "Wildlife",
  county_spotlight: "Spotlight",
  surprising_stat: "Surprise",
  historical_context: "History",
  fatality_paradox: "Fatality",
  speeding: "Speeding",
  urban_rural: "Urban vs Rural",
  time_of_day: "Time of Day",
  cause_breakdown: "Causes",
  data_quality: "Data Quality",
  holiday: "Holiday",
  vehicle_tech: "Vehicle Tech",
  income_inequality: "Income",
  motorcycle: "Motorcycle",
  recovery_pattern: "Recovery",
  commuter_corridor: "Commuter",
  weekend_weekday: "Weekday vs Weekend",
  age: "Age",
  injury_severity: "Severity",
  decade_comparison: "Decade",
  what_if: "What If",
  policy: "Policy",
  enforcement: "Enforcement",
  rideshare_impact: "Rideshare",
  intersection: "Intersection",
  hit_and_run: "Hit & Run",
  population_growth: "Population",
  gender: "Gender",
};

export default function AiInsightCard({
  onClose,
  countyName,
  data,
  measureLabel,
  compareMode,
  onCompare,
  compareCountyName,
  compareData,
  narrative,
  narrativeAngle,
  onRefreshNarrative,
  loading,
}: AiInsightCardProps) {
  const isStatewide = !data && !loading;
  const [expanded, setExpanded] = useState(() => {
    if (isStatewide) {
      const seen = localStorage.getItem("calsight-insight-seen");
      if (!seen) {
        localStorage.setItem("calsight-insight-seen", "1");
        return true;
      }
      return window.matchMedia("(min-width: 768px)").matches;
    }
    return window.matchMedia("(min-width: 768px)").matches;
  });
  const isComparing = compareMode && compareCountyName && compareData;

  return (
    <div className="fixed bottom-card-mobile left-0 right-0 z-40 md:absolute md:bottom-2 md:left-16 md:right-auto md:w-[480px] md:z-30">
      <div className="bg-surface-container-lowest/95 backdrop-blur-md ghost-border md:rounded-xl overflow-hidden max-h-[60vh] md:max-h-none flex flex-col">
        {/* Collapsed bar — always visible */}
        <div
          className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="min-w-0">
            <h3 className="font-headline text-base font-bold text-on-surface tracking-tight truncate">
              {isComparing ? `${countyName} vs ${compareCountyName}` : isStatewide ? "California Insight" : `${countyName} County`}
            </h3>
            {data && !expanded && (
              <p className="text-[11px] text-on-surface-variant mt-0.5">
                {fmt(data.rawCount)} crashes · {fmt(data.totalKilled)} killed
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="material-symbols-outlined text-[20px] text-on-surface-variant transition-transform p-1" style={{ transform: expanded ? "rotate(180deg)" : undefined }}>
              expand_less
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className="p-2 -mr-1 hover:bg-surface-container rounded-full text-on-surface-variant transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>

        {/* Expanded content */}
        {expanded && (
          <div className="px-4 pb-4 space-y-3 overflow-y-auto">
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
                {data ? (
                  <MetricGrid data={data} measureLabel={measureLabel} />
                ) : loading ? (
                  <SkeletonMetricGrid />
                ) : null}

                {/* AI narrative blurb — single-county mode only, hidden when null */}
                {!compareMode && narrative && (
                  <div className="bg-surface-container-lowest rounded-lg px-3 py-2.5 animate-[fadeIn_0.4s_ease] space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px] text-primary shrink-0">
                          auto_awesome
                        </span>
                        {narrativeAngle && (
                          <span className="text-[10px] text-on-surface-variant bg-surface-container px-1.5 py-0.5 rounded-full">
                            {ANGLE_LABELS[narrativeAngle] ?? narrativeAngle}
                          </span>
                        )}
                      </div>
                      {onRefreshNarrative && (
                        <button
                          onClick={onRefreshNarrative}
                          className="p-1 hover:bg-surface-container rounded-full text-on-surface-variant transition-colors"
                          title="Show another insight"
                        >
                          <span className="material-symbols-outlined text-[14px]">refresh</span>
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-on-surface-variant font-body leading-relaxed md:line-clamp-none line-clamp-4">
                      {narrative}
                    </p>
                  </div>
                )}

                {compareMode && !compareCountyName && (
                  <p className="text-xs text-on-surface-variant text-center py-1">
                    Click a county to compare
                  </p>
                )}

                {!compareMode && data && (
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

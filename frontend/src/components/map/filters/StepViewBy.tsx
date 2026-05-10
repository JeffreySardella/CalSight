import type { MeasureKey } from "../../../lib/choropleth/measures";
import type { StagedFilters } from "../../../hooks/useStagedFilters";

interface StepViewByProps {
  measure: MeasureKey;
  onSetMeasure: (m: MeasureKey) => void;
  staged?: StagedFilters;
  crashCount?: number | null;
  crashCountLoading?: boolean;
}

const MEASURE_LIST: { key: MeasureKey; label: string; description: string; group?: string }[] = [
  { key: "crashes_raw", label: "Total Crashes", description: "Raw crash count per county", group: "Crash Metrics" },
  { key: "crashes_per_100k", label: "Per 100K Residents", description: "Normalized by population — shows crash rate, not just volume", group: "Crash Metrics" },
  { key: "fatalities_per_100k", label: "Fatalities per 100K", description: "Fatal crashes normalized by population", group: "Crash Metrics" },
  { key: "injuries_per_100k", label: "Injuries per 100K", description: "Injury crashes normalized by population", group: "Crash Metrics" },
  { key: "fatality_rate", label: "Fatality Rate %", description: "What percentage of crashes are fatal", group: "Crash Metrics" },
  { key: "crashes_per_income", label: "Per $100K Income", description: "Crash rate relative to median household income", group: "Crash Metrics" },
  { key: "crashes_per_poverty", label: "Crashes per Poverty %", description: "Crash rate weighted by poverty — crashes per 1% poverty per 100K pop", group: "Crash + Demographics" },
  { key: "poverty_rate", label: "Poverty Rate", description: "Average poverty rate by county", group: "Demographics" },
  { key: "median_income", label: "Median Income", description: "Median household income by county", group: "Demographics" },
  { key: "pct_no_vehicle", label: "No Vehicle %", description: "Percentage of households with no vehicle", group: "Demographics" },
  { key: "pct_bachelors", label: "Bachelor's Degree %", description: "Percentage with bachelor's degree or higher", group: "Demographics" },
  { key: "pct_65_plus", label: "Age 65+ %", description: "Percentage of population age 65 and older", group: "Demographics" },
  { key: "ces_score", label: "CES Composite Score", description: "CalEnviroScreen overall environmental burden score", group: "Environmental" },
  { key: "pollution_burden", label: "Pollution Burden", description: "CalEnviroScreen pollution burden score", group: "Environmental" },
  { key: "traffic_score", label: "Traffic Proximity", description: "CalEnviroScreen traffic proximity and volume score", group: "Environmental" },
  { key: "unemployment_rate", label: "Unemployment Rate", description: "Average unemployment rate across selected period", group: "Economic" },
];

const CRASH_MEASURES: MeasureKey[] = [
  "crashes_raw", "crashes_per_100k", "fatalities_per_100k", "injuries_per_100k",
  "fatality_rate", "crashes_per_income", "crashes_per_poverty",
];

const DEMO_MEASURES: MeasureKey[] = [
  "poverty_rate", "median_income", "pct_no_vehicle", "pct_bachelors",
  "crashes_per_poverty", "pct_65_plus", "crashes_per_income",
];

const CONTEXT_MEASURES: MeasureKey[] = [
  "ces_score", "pollution_burden", "traffic_score", "unemployment_rate",
];

const PER_CAPITA_MEASURES: MeasureKey[] = [
  "crashes_per_100k", "fatalities_per_100k", "injuries_per_100k",
];

function needsDemoInfo(m: MeasureKey): boolean {
  return PER_CAPITA_MEASURES.includes(m) || DEMO_MEASURES.includes(m) || CONTEXT_MEASURES.includes(m);
}

function demoInfoText(m: MeasureKey): string {
  if (m === "unemployment_rate") {
    return "Unemployment data from EDD. Counties without data show as hatched.";
  }
  if (CONTEXT_MEASURES.includes(m)) {
    return "CalEnviroScreen data averaged to county level. Counties without data show as hatched.";
  }
  if (DEMO_MEASURES.includes(m)) {
    return "Demographic data available 2005-2023. Counties without data show as hatched.";
  }
  return "Population data available 2005-2023. Earlier years show as hatched.";
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

function getSelectedYearRange(staged?: StagedFilters): { min: number; max: number } | null {
  if (!staged) return null;
  if (staged.dateRange) {
    return {
      min: staged.dateRange.start?.year ?? 2001,
      max: staged.dateRange.end?.year ?? new Date().getFullYear(),
    };
  }
  if (staged.selectedYears.size > 0) {
    const years = [...staged.selectedYears];
    return { min: Math.min(...years), max: Math.max(...years) };
  }
  return null;
}

function hasDemoOverlap(range: { min: number; max: number } | null): boolean {
  if (!range) return true;
  return range.max >= 2005 && range.min <= 2023;
}

function isMeasureAvailable(key: MeasureKey, staged?: StagedFilters, crashCount?: number | null): { available: boolean; reason?: string } {
  const range = getSelectedYearRange(staged);

  if (PER_CAPITA_MEASURES.includes(key) || DEMO_MEASURES.includes(key)) {
    if (!hasDemoOverlap(range)) {
      return { available: false, reason: "No demographics data for selected years (available 2005–2023)" };
    }
  }

  if (key === "unemployment_rate") {
    if (range && range.max < 2005) {
      return { available: false, reason: "Unemployment data starts at 2005" };
    }
  }

  if (CRASH_MEASURES.includes(key) && crashCount != null && crashCount === 0) {
    return { available: false, reason: "No crashes match current filters" };
  }

  const hasCrashFilters = staged && (
    staged.severities.size > 0 || staged.causes.size > 0
    || staged.alcohol || staged.distracted || staged.pedestrian
    || staged.cyclist || staged.drug || staged.driverAge !== null
    || staged.weather.size > 0 || staged.lighting.size > 0
    || staged.collisionType.size > 0 || staged.roadType !== null
    || staged.hitRun
  );

  const isPureDemoOrContext = (DEMO_MEASURES.includes(key) || CONTEXT_MEASURES.includes(key))
    && !CRASH_MEASURES.includes(key);

  if (hasCrashFilters && isPureDemoOrContext) {
    return { available: false, reason: "Not relevant with crash filters active" };
  }

  return { available: true };
}

function getMeasureSubtext(key: MeasureKey, m: { description: string }, available: boolean, reason: string | undefined, crashCount: number | null | undefined, staged?: StagedFilters): string {
  if (!available) return reason ?? "";

  const range = getSelectedYearRange(staged);

  if (CRASH_MEASURES.includes(key) && crashCount != null) {
    const base = `${fmt(crashCount)} crashes`;
    if ((PER_CAPITA_MEASURES.includes(key) || DEMO_MEASURES.includes(key)) && range && !hasDemoOverlap(range)) {
      return base;
    }
    if (PER_CAPITA_MEASURES.includes(key) || DEMO_MEASURES.includes(key)) {
      return `${base} · 58 counties with demographics`;
    }
    return base;
  }

  if (DEMO_MEASURES.includes(key) && !CRASH_MEASURES.includes(key)) {
    return "58 counties · Census ACS data";
  }

  if (CONTEXT_MEASURES.includes(key)) {
    return key === "unemployment_rate" ? "58 counties · EDD data" : "58 counties · CalEnviroScreen";
  }

  return m.description;
}

export default function StepViewBy({ measure, onSetMeasure, staged, crashCount, crashCountLoading }: StepViewByProps) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-on-surface mb-1">How should the map display data?</h3>
        <p className="text-[11px] text-on-surface-variant leading-snug">
          Choose how to color the choropleth map. Per-capita measures normalize by population so small and large counties are comparable.
        </p>
      </div>

      <div className="space-y-2">
        {(() => {
          const visible = MEASURE_LIST.filter((m) => isMeasureAvailable(m.key, staged, crashCount).available);
          const visibleGroups = new Set(visible.map((m) => m.group));
          let lastGroup: string | undefined;

          return visible.map((m) => {
            const showHeader = m.group && m.group !== lastGroup && visibleGroups.has(m.group);
            if (m.group) lastGroup = m.group;
            const subtext = getMeasureSubtext(m.key, m, true, undefined, crashCount, staged);
            return (
              <div key={m.key}>
                {showHeader && (
                  <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mt-3 mb-1">
                    {m.group}
                  </p>
                )}
                <button
                  onClick={() => onSetMeasure(m.key)}
                  className={`w-full text-left px-4 py-3 rounded-xl transition-all ${
                    measure === m.key
                      ? "bg-primary text-on-primary"
                      : "bg-surface-container-high text-on-surface hover:bg-surface-variant"
                  }`}
                >
                  <p className="text-sm font-semibold">
                    {m.label}
                    {CRASH_MEASURES.includes(m.key) && crashCount != null && !crashCountLoading && (
                      <span className="text-xs font-normal ml-2 opacity-70">({fmt(crashCount)})</span>
                    )}
                    {CRASH_MEASURES.includes(m.key) && crashCountLoading && (
                      <span className="text-xs font-normal ml-2 opacity-50 animate-pulse">…</span>
                    )}
                  </p>
                  <p className={`text-[10px] mt-0.5 ${
                    measure === m.key ? "text-on-primary/80" : "text-on-surface-variant"
                  }`}>
                    {subtext}
                  </p>
                </button>
              </div>
            );
          });
        })()}
      </div>

      {needsDemoInfo(measure) && (
        <div className="flex items-center gap-2 bg-tertiary-container/30 rounded-lg px-3 py-2">
          <span className="material-symbols-outlined text-[14px] text-tertiary">info</span>
          <p className="text-[10px] text-on-surface-variant">
            {demoInfoText(measure)}
          </p>
        </div>
      )}
    </div>
  );
}

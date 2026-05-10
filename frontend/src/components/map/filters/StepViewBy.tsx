import type { MeasureKey } from "../../../lib/choropleth/measures";
import type { StagedFilters } from "../../../hooks/useStagedFilters";

interface StepViewByProps {
  measure: MeasureKey;
  onSetMeasure: (m: MeasureKey) => void;
  staged?: StagedFilters;
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

function isMeasureAvailable(key: MeasureKey, staged?: StagedFilters): { available: boolean; reason?: string } {
  const range = getSelectedYearRange(staged);

  if (PER_CAPITA_MEASURES.includes(key) || DEMO_MEASURES.includes(key)) {
    if (range && range.max < 2005) {
      return { available: false, reason: "Demographics data starts at 2005" };
    }
    if (range && range.min > 2023) {
      return { available: false, reason: "Demographics data ends at 2023" };
    }
  }

  if (key === "unemployment_rate") {
    if (range && range.max < 2005) {
      return { available: false, reason: "Unemployment data starts at 2005" };
    }
  }

  return { available: true };
}

export default function StepViewBy({ measure, onSetMeasure, staged }: StepViewByProps) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-on-surface mb-1">How should the map display data?</h3>
        <p className="text-[11px] text-on-surface-variant leading-snug">
          Choose how to color the choropleth map. Per-capita measures normalize by population so small and large counties are comparable.
        </p>
      </div>

      <div className="space-y-2">
        {MEASURE_LIST.map((m, i) => {
          const prevGroup = i > 0 ? MEASURE_LIST[i - 1].group : undefined;
          const showHeader = m.group && m.group !== prevGroup;
          const { available, reason } = isMeasureAvailable(m.key, staged);
          return (
            <div key={m.key}>
              {showHeader && (
                <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mt-3 mb-1">
                  {m.group}
                </p>
              )}
              <button
                onClick={available ? () => onSetMeasure(m.key) : undefined}
                disabled={!available}
                className={`w-full text-left px-4 py-3 rounded-xl transition-all ${
                  !available
                    ? "bg-surface-container-high/50 text-on-surface-variant/40 cursor-not-allowed"
                    : measure === m.key
                      ? "bg-primary text-on-primary"
                      : "bg-surface-container-high text-on-surface hover:bg-surface-variant"
                }`}
              >
                <p className="text-sm font-semibold">{m.label}</p>
                <p className={`text-[10px] mt-0.5 ${
                  !available
                    ? "text-on-surface-variant/30"
                    : measure === m.key ? "text-on-primary/80" : "text-on-surface-variant"
                }`}>
                  {available ? m.description : reason}
                </p>
              </button>
            </div>
          );
        })}
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

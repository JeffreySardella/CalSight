import type { MeasureKey } from "../../../lib/choropleth/measures";

interface StepViewByProps {
  measure: MeasureKey;
  onSetMeasure: (m: MeasureKey) => void;
}

const MEASURE_LIST: { key: MeasureKey; label: string; description: string }[] = [
  { key: "crashes_raw", label: "Total Crashes", description: "Raw crash count per county" },
  { key: "crashes_per_100k", label: "Per 100K Residents", description: "Normalized by population — shows crash rate, not just volume" },
  { key: "fatalities_per_100k", label: "Fatalities per 100K", description: "Fatal crashes normalized by population" },
  { key: "injuries_per_100k", label: "Injuries per 100K", description: "Injury crashes normalized by population" },
  { key: "fatality_rate", label: "Fatality Rate %", description: "What percentage of crashes are fatal" },
  { key: "crashes_per_income", label: "Per $100K Income", description: "Crash rate relative to median household income" },
];

export default function StepViewBy({ measure, onSetMeasure }: StepViewByProps) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-on-surface mb-1">How should the map display data?</h3>
        <p className="text-[11px] text-on-surface-variant leading-snug">
          Choose how to color the choropleth map. Per-capita measures normalize by population so small and large counties are comparable.
        </p>
      </div>

      <div className="space-y-2">
        {MEASURE_LIST.map((m) => (
          <button
            key={m.key}
            onClick={() => onSetMeasure(m.key)}
            className={`w-full text-left px-4 py-3 rounded-xl transition-all ${
              measure === m.key
                ? "bg-primary text-on-primary"
                : "bg-surface-container-high text-on-surface hover:bg-surface-variant"
            }`}
          >
            <p className="text-sm font-semibold">{m.label}</p>
            <p className={`text-[10px] mt-0.5 ${
              measure === m.key ? "text-on-primary/80" : "text-on-surface-variant"
            }`}>
              {m.description}
            </p>
          </button>
        ))}
      </div>

      {(measure === "crashes_per_100k" || measure === "fatalities_per_100k" || measure === "injuries_per_100k" || measure === "crashes_per_income") && (
        <div className="flex items-center gap-2 bg-tertiary-container/30 rounded-lg px-3 py-2">
          <span className="material-symbols-outlined text-[14px] text-tertiary">info</span>
          <p className="text-[10px] text-on-surface-variant">
            {measure === "crashes_per_income"
              ? "Income data available 2005-2023. Counties without income data show as hatched."
              : "Population data available 2005-2023. Earlier years show as hatched."}
          </p>
        </div>
      )}
    </div>
  );
}

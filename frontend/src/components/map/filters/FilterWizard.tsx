import { useState, useCallback } from "react";
import { CA_COUNTIES } from "../../../hooks/useFilterParams";
import { useLayersState } from "../../../hooks/useLayersState";
import { useStagedFilters, type StagedFilters } from "../../../hooks/useStagedFilters";
import SearchableMultiSelect from "../../ui/SearchableMultiSelect";
import StepWhen from "./StepWhen";
import StepWhat from "./StepWhat";
import StepWho from "./StepWho";
import StepViewBy from "./StepViewBy";
import StepDisplay from "./StepDisplay";

const STEPS = ["When", "What", "Who", "View", "Display"] as const;

const countyOptions = [
  { value: "__all__", label: "All Counties (Statewide)" },
  ...CA_COUNTIES.map((c) => ({ value: c, label: c })),
];
const ALL_COUNTIES_SET = new Set(["__all__"]);

interface FilterWizardProps {
  initial: StagedFilters;
  selectedCounties: Set<string>;
  onToggleCounty: (county: string) => void;
  onClearCounties: () => void;
  onApply: (filters: StagedFilters) => void;
  onClear: () => void;
}

export default function FilterWizard({
  initial,
  selectedCounties,
  onToggleCounty,
  onClearCounties,
  onApply,
  onClear,
}: FilterWizardProps) {
  const [step, setStep] = useState(0);
  const {
    staged, toggleYear, setAllYears,
    toggleSeverity, clearSeverities,
    toggleCause, clearCauses,
    toggleInvolvement, setDriverAge,
    clearAll, has2016Plus,
  } = useStagedFilters(initial);

  const {
    choroplethOn, setChoroplethOn,
    measure, setMeasure,
    palette, setPalette,
    otherLayers, toggleOtherLayer, setOtherLayer,
  } = useLayersState();

  const handleApply = useCallback(() => {
    onApply(staged);
  }, [staged, onApply]);

  const handleClear = useCallback(() => {
    clearAll();
    onClear();
  }, [clearAll, onClear]);

  const lastStep = STEPS.length - 1;

  return (
    <div className="space-y-4">
      {/* County — always visible */}
      <div className="pb-4 border-b border-outline-variant/15">
        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2 block">
          County
        </label>
        <SearchableMultiSelect
          options={countyOptions}
          selected={selectedCounties.size === 0 ? ALL_COUNTIES_SET : selectedCounties}
          nonDismissableValues={ALL_COUNTIES_SET}
          onToggle={(value) => {
            if (value === "__all__") onClearCounties();
            else onToggleCounty(value);
          }}
          placeholder="Search California Counties..."
        />
      </div>

      {/* Step dots */}
      <div className="flex items-center justify-center gap-2 py-3 flex-wrap">
        {STEPS.map((label, i) => (
          <button
            key={label}
            onClick={() => setStep(i)}
            className="flex items-center gap-1"
          >
            <div className={`w-2 h-2 rounded-full transition-all ${
              i === step ? "bg-primary scale-125" : i < step ? "bg-primary/50" : "bg-outline-variant/30"
            }`} />
            <span className={`text-[9px] font-semibold transition-colors ${
              i === step ? "text-on-surface" : "text-on-surface-variant/50"
            }`}>
              {label}
            </span>
          </button>
        ))}
      </div>

      {/* Step content */}
      <div className="pb-4">
        {step === 0 && (
          <StepWhen staged={staged} onToggleYear={toggleYear} onSetAllYears={setAllYears} />
        )}
        {step === 1 && (
          <StepWhat
            staged={staged}
            onToggleCause={toggleCause}
            onClearCauses={clearCauses}
            onToggleSeverity={toggleSeverity}
            onClearSeverities={clearSeverities}
          />
        )}
        {step === 2 && (
          <StepWho
            staged={staged}
            has2016Plus={has2016Plus}
            onToggleInvolvement={toggleInvolvement}
            onSetDriverAge={setDriverAge}
          />
        )}
        {step === 3 && (
          <StepViewBy
            measure={measure}
            onSetMeasure={setMeasure}
          />
        )}
        {step === 4 && (
          <StepDisplay
            choroplethOn={choroplethOn}
            onToggleChoropleth={() => {
              if (choroplethOn && !otherLayers.heatmapStatewide) return;
              setChoroplethOn(!choroplethOn);
              if (!choroplethOn) setOtherLayer("heatmapStatewide", false);
            }}
            heatmapOn={otherLayers.heatmapStatewide}
            onToggleHeatmap={() => {
              if (otherLayers.heatmapStatewide && !choroplethOn) return;
              setOtherLayer("heatmapStatewide", !otherLayers.heatmapStatewide);
              if (!otherLayers.heatmapStatewide) setChoroplethOn(false);
            }}
            palette={palette}
            onSetPalette={setPalette}
            countyBoundaries={otherLayers.countyBoundaries}
            onToggleBoundaries={() => toggleOtherLayer("countyBoundaries")}
          />
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-3 pt-4 pb-2 border-t border-outline-variant/15 sticky bottom-0 bg-surface-container-lowest">
        {step > 0 && (
          <button
            onClick={() => setStep((s) => s - 1)}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-on-surface-variant hover:text-on-surface transition-colors"
          >
            Back
          </button>
        )}
        <button
          onClick={handleClear}
          className="text-sm font-semibold text-on-surface-variant hover:text-on-surface transition-colors"
        >
          Clear All
        </button>
        <div className="flex-1" />
        {step < lastStep ? (
          <button
            onClick={() => setStep((s) => s + 1)}
            className="px-6 py-2.5 rounded-xl text-sm font-bold bg-primary-container text-on-primary-container hover:opacity-90 transition-opacity"
          >
            Next
          </button>
        ) : (
          <button
            onClick={handleApply}
            className="px-6 py-2.5 rounded-xl text-sm font-bold bg-primary text-on-primary hover:opacity-90 transition-opacity"
          >
            Apply Filters
          </button>
        )}
      </div>
    </div>
  );
}

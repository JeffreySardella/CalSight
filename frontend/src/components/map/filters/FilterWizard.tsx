import { useState, useCallback } from "react";
import { CA_COUNTIES } from "../../../hooks/useFilterParams";
import { useLayersState } from "../../../hooks/useLayersState";
import { useStagedFilters, type StagedFilters } from "../../../hooks/useStagedFilters";
import { useLiveCrashCount } from "../../../hooks/useLiveCrashCount";
import { useFacetCounts } from "../../../hooks/useFacetCounts";
import SearchableMultiSelect from "../../ui/SearchableMultiSelect";
import StepWhen from "./StepWhen";
import StepWhat from "./StepWhat";
import StepWho from "./StepWho";
import StepConditions from "./StepConditions";
import StepViewBy from "./StepViewBy";
import StepDisplay from "./StepDisplay";

const STEPS = ["When", "What", "Who", "Conditions", "View", "Display"] as const;

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
    toggleInvolvement, setDateRange, setDriverAge,
    toggleWeather, clearWeather,
    toggleLighting, clearLighting,
    toggleCollisionType, clearCollisionType,
    setRoadType, toggleHitRun,
    clearAll, has2016Plus,
  } = useStagedFilters(initial);

  const {
    choroplethOn, setChoroplethOn,
    measure, setMeasure,
    palette, setPalette,
    otherLayers, toggleOtherLayer, setOtherLayer,
  } = useLayersState();

  const { count: liveCount, loading: countLoading } = useLiveCrashCount(staged);
  const facets = useFacetCounts(staged);

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
      {/* County */}
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
      <div className="flex items-center justify-center gap-2 py-2 flex-wrap">
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

      {/* Current filter summary */}
      {(staged.selectedYears.size > 0 || staged.severities.size > 0 || staged.causes.size > 0 || staged.alcohol || staged.pedestrian || staged.cyclist || staged.drug || staged.distracted || staged.driverAge) && (
        <div className="flex items-center gap-2 flex-wrap px-1 pb-3">
          <span className="text-[10px] text-on-surface-variant">Active:</span>
          {staged.selectedYears.size > 0 && (
            <span className="text-[9px] bg-primary-container text-on-primary-container px-1.5 py-0.5 rounded-full">
              {staged.selectedYears.size} year{staged.selectedYears.size > 1 ? "s" : ""}
            </span>
          )}
          {[...staged.severities].map((s) => (
            <span key={s} className="text-[9px] bg-primary-container text-on-primary-container px-1.5 py-0.5 rounded-full">{s}</span>
          ))}
          {[...staged.causes].map((c) => (
            <span key={c} className="text-[9px] bg-primary-container text-on-primary-container px-1.5 py-0.5 rounded-full">{c}</span>
          ))}
          {staged.alcohol && <span className="text-[9px] bg-tertiary-container text-on-tertiary-container px-1.5 py-0.5 rounded-full">Alcohol</span>}
          {staged.pedestrian && <span className="text-[9px] bg-tertiary-container text-on-tertiary-container px-1.5 py-0.5 rounded-full">Pedestrian</span>}
          {staged.cyclist && <span className="text-[9px] bg-tertiary-container text-on-tertiary-container px-1.5 py-0.5 rounded-full">Cyclist</span>}
          {staged.drug && <span className="text-[9px] bg-tertiary-container text-on-tertiary-container px-1.5 py-0.5 rounded-full">Drug</span>}
          {staged.distracted && <span className="text-[9px] bg-tertiary-container text-on-tertiary-container px-1.5 py-0.5 rounded-full">Distracted</span>}
          {staged.driverAge && <span className="text-[9px] bg-tertiary-container text-on-tertiary-container px-1.5 py-0.5 rounded-full">Age {staged.driverAge}</span>}
          {facets.loading && <span className="text-[9px] text-on-surface-variant animate-pulse">updating...</span>}
        </div>
      )}

      {/* Step content */}
      <div className="pb-4">
        {step === 0 && (
          <StepWhen staged={staged} onToggleYear={toggleYear} onSetAllYears={setAllYears} onSetDateRange={setDateRange} yearCounts={facets.years} loading={!facets.loaded} />
        )}
        {step === 1 && (
          <StepWhat
            staged={staged}
            onToggleCause={toggleCause}
            onClearCauses={clearCauses}
            onToggleSeverity={toggleSeverity}
            onClearSeverities={clearSeverities}
            causeCounts={facets.causes}
            severityCounts={facets.severities}
            loading={!facets.loaded}
          />
        )}
        {step === 2 && (
          <StepWho
            staged={staged}
            has2016Plus={has2016Plus}
            onToggleInvolvement={toggleInvolvement}
            onSetDriverAge={setDriverAge}
            involvementCounts={facets.involvement}
            driverAgeCounts={facets.driverAge}
            loading={!facets.loaded}
          />
        )}
        {step === 3 && (
          <StepConditions
            weather={staged.weather}
            lighting={staged.lighting}
            collisionType={staged.collisionType}
            roadType={staged.roadType}
            hitRun={staged.hitRun}
            onToggleWeather={toggleWeather}
            onClearWeather={clearWeather}
            onToggleLighting={toggleLighting}
            onClearLighting={clearLighting}
            onToggleCollisionType={toggleCollisionType}
            onClearCollisionType={clearCollisionType}
            onSetRoadType={setRoadType}
            onToggleHitRun={toggleHitRun}
            conditionCounts={facets.conditions}
            loading={!facets.loaded}
          />
        )}
        {step === 4 && (
          <StepViewBy
            measure={measure}
            onSetMeasure={setMeasure}
          />
        )}
        {step === 5 && (
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
            hospitalsOn={otherLayers.hospitals}
            onToggleHospitals={() => toggleOtherLayer("hospitals")}
            schoolsOn={otherLayers.schools}
            onToggleSchools={() => toggleOtherLayer("schools")}
          />
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-3 pt-4 pb-2 border-t border-outline-variant/15">
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
            {countLoading ? "Loading..." : liveCount !== null ? `Show ${liveCount >= 1000000 ? `${(liveCount / 1000000).toFixed(1)}M` : liveCount >= 1000 ? `${Math.round(liveCount / 1000)}K` : liveCount.toLocaleString()} Crashes` : "Apply Filters"}
          </button>
        )}
      </div>
    </div>
  );
}

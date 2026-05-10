import { useCallback } from "react";
import { YEARS, CAUSES, SEVERITIES, CA_COUNTIES } from "../../../hooks/useFilterParams";
import { useStagedFilters, type StagedFilters } from "../../../hooks/useStagedFilters";
import SearchableMultiSelect from "../../ui/SearchableMultiSelect";
import FilterChip from "./FilterChip";
import FilterPresets from "./FilterPresets";

const RECENT_YEARS = YEARS.filter((y) => y >= 2016).reverse();
const TOP_CAUSES = CAUSES.filter((c) =>
  ["dui", "speeding", "right-of-way", "turning", "following-too-close"].includes(c.value)
);

const countyOptions = [
  { value: "__all__", label: "All Counties (Statewide)" },
  ...CA_COUNTIES.map((c) => ({ value: c, label: c })),
];
const ALL_COUNTIES_SET = new Set(["__all__"]);

interface SimpleFilterPanelProps {
  initial: StagedFilters;
  selectedCounties: Set<string>;
  onToggleCounty: (county: string) => void;
  onClearCounties: () => void;
  onApply: (filters: StagedFilters) => void;
  onClear: () => void;
  onSwitchToAdvanced: () => void;
}

export default function SimpleFilterPanel({
  initial,
  selectedCounties,
  onToggleCounty,
  onClearCounties,
  onApply,
  onClear,
  onSwitchToAdvanced,
}: SimpleFilterPanelProps) {
  const {
    staged, toggleYear, setAllYears,
    toggleSeverity, clearSeverities,
    toggleCause, clearCauses,
    clearAll, reset,
  } = useStagedFilters(initial);

  const handlePreset = useCallback((preset: Partial<StagedFilters>) => {
    const base: StagedFilters = {
      selectedYears: new Set(),
      dateRange: null,
      severities: new Set(),
      causes: new Set(),
      alcohol: false,
      distracted: false,
      pedestrian: false,
      cyclist: false,
      drug: false,
      driverAge: null,
    };
    reset({ ...base, ...preset });
    onApply({ ...base, ...preset });
  }, [reset, onApply]);

  const handleApply = useCallback(() => {
    onApply(staged);
  }, [staged, onApply]);

  const handleClear = useCallback(() => {
    clearAll();
    onClear();
  }, [clearAll, onClear]);

  const allYears = staged.selectedYears.size === 0;
  const allCauses = staged.causes.size === 0;
  const allSeverities = staged.severities.size === 0;

  return (
    <div className="space-y-6">
      {/* County */}
      <div>
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

      {/* Years */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-on-surface">Time Period</h3>
        <p className="text-[11px] text-on-surface-variant">Recent years shown. Use Advanced for 2001-2015.</p>
        <div className="flex flex-wrap gap-2">
          <FilterChip label="All Years" active={allYears} onClick={setAllYears} />
          {RECENT_YEARS.map((year) => (
            <FilterChip
              key={year}
              label={String(year)}
              active={!allYears && staged.selectedYears.has(year)}
              onClick={() => toggleYear(year)}
            />
          ))}
        </div>
      </div>

      {/* Severity */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-on-surface">Severity</h3>
        <div className="flex flex-wrap gap-2">
          <FilterChip label="All" active={allSeverities} onClick={clearSeverities} />
          {SEVERITIES.map((s) => (
            <FilterChip
              key={s}
              label={s}
              active={!allSeverities && staged.severities.has(s)}
              onClick={() => toggleSeverity(s)}
            />
          ))}
        </div>
      </div>

      {/* Top causes */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-on-surface">Common Causes</h3>
        <div className="flex flex-wrap gap-2">
          <FilterChip label="All" active={allCauses} onClick={clearCauses} />
          {TOP_CAUSES.map((cause) => (
            <FilterChip
              key={cause.value}
              label={cause.label}
              icon={cause.icon}
              active={!allCauses && staged.causes.has(cause.value)}
              onClick={() => toggleCause(cause.value)}
            />
          ))}
        </div>
      </div>

      {/* Presets */}
      <FilterPresets onApplyPreset={handlePreset} />

      {/* Advanced toggle */}
      <button
        onClick={onSwitchToAdvanced}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-surface-container-high text-on-surface-variant hover:bg-surface-variant transition-colors text-sm font-semibold"
      >
        <span className="material-symbols-outlined text-[16px]">tune</span>
        More Filters (Weather, Involvement, Display)
      </button>

      {/* Footer */}
      <div className="flex items-center gap-3 pt-4 pb-2 border-t border-outline-variant/15 sticky bottom-0 bg-surface-container-lowest">
        <button
          onClick={handleClear}
          className="text-sm font-semibold text-on-surface-variant hover:text-on-surface transition-colors"
        >
          Clear All
        </button>
        <div className="flex-1" />
        <button
          onClick={handleApply}
          className="px-6 py-2.5 rounded-xl text-sm font-bold bg-primary text-on-primary hover:opacity-90 transition-opacity"
        >
          Apply Filters
        </button>
      </div>
    </div>
  );
}

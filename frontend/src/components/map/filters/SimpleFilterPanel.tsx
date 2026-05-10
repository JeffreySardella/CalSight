import { useCallback } from "react";
import { YEARS, CAUSES, SEVERITIES, CA_COUNTIES } from "../../../hooks/useFilterParams";
import { useStagedFilters, type StagedFilters } from "../../../hooks/useStagedFilters";
import { useLiveCrashCount } from "../../../hooks/useLiveCrashCount";
import { useFacetCounts } from "../../../hooks/useFacetCounts";
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
}

function fmtC(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString();
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString();
}

export default function SimpleFilterPanel({
  initial,
  selectedCounties,
  onToggleCounty,
  onClearCounties,
  onApply,
  onClear,
}: SimpleFilterPanelProps) {
  const {
    staged, toggleYear, setAllYears,
    toggleSeverity, clearSeverities,
    toggleCause, clearCauses,
    clearAll, reset,
  } = useStagedFilters(initial);

  const { count: liveCount, loading: countLoading } = useLiveCrashCount(staged);
  const facets = useFacetCounts(staged);

  const handlePreset = useCallback((preset: Partial<StagedFilters>) => {
    const merged: StagedFilters = {
      selectedYears: preset.selectedYears ?? new Set(),
      dateRange: preset.dateRange ?? null,
      severities: preset.severities ?? new Set(),
      causes: preset.causes ?? new Set(),
      alcohol: preset.alcohol ?? false,
      distracted: preset.distracted ?? false,
      pedestrian: preset.pedestrian ?? false,
      cyclist: preset.cyclist ?? false,
      drug: preset.drug ?? false,
      driverAge: preset.driverAge ?? null,
    };
    reset(merged);
  }, [reset]);

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
    <div className="space-y-6 pb-4">
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
          {RECENT_YEARS.map((year) => {
            const count = facets.years[year];
            return (
              <FilterChip
                key={year}
                label={String(year)}
                count={count != null ? fmtC(count) : undefined}
                active={!allYears && staged.selectedYears.has(year)}
                disabled={count != null && count === 0}
                onClick={() => toggleYear(year)}
              />
            );
          })}
        </div>
      </div>

      {/* Severity */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-on-surface">Severity</h3>
        <div className="flex flex-wrap gap-2">
          <FilterChip label="All" active={allSeverities} onClick={clearSeverities} />
          {SEVERITIES.map((s) => {
            const count = facets.severities[s];
            return (
              <FilterChip
                key={s}
                label={s}
                count={count != null ? fmtC(count) : undefined}
                active={!allSeverities && staged.severities.has(s)}
                disabled={count != null && count === 0}
                onClick={() => toggleSeverity(s)}
              />
            );
          })}
        </div>
      </div>

      {/* Top causes */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-on-surface">Common Causes</h3>
        <div className="flex flex-wrap gap-2">
          <FilterChip label="All" active={allCauses} onClick={clearCauses} />
          {TOP_CAUSES.map((cause) => {
            const count = facets.causes[cause.value];
            return (
              <FilterChip
                key={cause.value}
                label={cause.label}
                icon={cause.icon}
                count={count != null ? fmtC(count) : undefined}
                active={!allCauses && staged.causes.has(cause.value)}
                disabled={count != null && count === 0}
                onClick={() => toggleCause(cause.value)}
              />
            );
          })}
        </div>
      </div>

      {/* Presets */}
      <FilterPresets staged={staged} onApplyPreset={handlePreset} />

      {/* Footer — at bottom of scroll content */}
      <div className="flex items-center gap-3 pt-4 border-t border-outline-variant/15">
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
          {countLoading ? "Loading..." : liveCount !== null ? `Show ${fmtCount(liveCount)} Crashes` : "Apply Filters"}
        </button>
      </div>
    </div>
  );
}

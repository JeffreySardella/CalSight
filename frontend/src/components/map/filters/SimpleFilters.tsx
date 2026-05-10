import { YEARS, CAUSES, SEVERITIES } from "../../../hooks/useFilterParams";
import type { StagedFilters } from "../../../hooks/useStagedFilters";
import FilterChip from "./FilterChip";

interface SimpleFiltersProps {
  staged: StagedFilters;
  onToggleYear: (year: number) => void;
  onSetAllYears: () => void;
  onToggleCause: (cause: string) => void;
  onClearCauses: () => void;
  onToggleSeverity: (severity: string) => void;
  onClearSeverities: () => void;
  onShowAdvanced: () => void;
}

const RECENT_YEARS = YEARS.filter((y) => y >= 2016).reverse();
const TOP_CAUSES = CAUSES.filter((c) =>
  ["dui", "speeding", "right-of-way", "turning", "following-too-close"].includes(c.value)
);

export default function SimpleFilters({
  staged,
  onToggleYear,
  onSetAllYears,
  onToggleCause,
  onClearCauses,
  onToggleSeverity,
  onClearSeverities,
  onShowAdvanced,
}: SimpleFiltersProps) {
  const allYears = staged.selectedYears.size === 0;
  const allCauses = staged.causes.size === 0;
  const allSeverities = staged.severities.size === 0;

  return (
    <div className="space-y-6">
      {/* Years */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-on-surface">Time Period</h3>
        <div className="flex flex-wrap gap-2">
          <FilterChip label="All Years" active={allYears} onClick={onSetAllYears} />
          {RECENT_YEARS.map((year) => (
            <FilterChip
              key={year}
              label={String(year)}
              active={!allYears && staged.selectedYears.has(year)}
              onClick={() => onToggleYear(year)}
            />
          ))}
        </div>
      </div>

      {/* Severity */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-on-surface">Severity</h3>
        <div className="flex flex-wrap gap-2">
          <FilterChip label="All" active={allSeverities} onClick={onClearSeverities} />
          {SEVERITIES.map((s) => (
            <FilterChip
              key={s}
              label={s}
              active={!allSeverities && staged.severities.has(s)}
              onClick={() => onToggleSeverity(s)}
            />
          ))}
        </div>
      </div>

      {/* Top causes */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-on-surface">Common Causes</h3>
        <div className="flex flex-wrap gap-2">
          <FilterChip label="All" active={allCauses} onClick={onClearCauses} />
          {TOP_CAUSES.map((cause) => (
            <FilterChip
              key={cause.value}
              label={cause.label}
              icon={cause.icon}
              active={!allCauses && staged.causes.has(cause.value)}
              onClick={() => onToggleCause(cause.value)}
            />
          ))}
        </div>
      </div>

      {/* Advanced toggle */}
      <button
        onClick={onShowAdvanced}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-surface-container-high text-on-surface-variant hover:bg-surface-variant transition-colors text-sm font-semibold"
      >
        <span className="material-symbols-outlined text-[16px]">tune</span>
        More Filters
      </button>
    </div>
  );
}

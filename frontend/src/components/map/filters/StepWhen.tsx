import { YEARS } from "../../../hooks/useFilterParams";
import type { StagedFilters } from "../../../hooks/useStagedFilters";
import FilterChip from "./FilterChip";

interface StepWhenProps {
  staged: StagedFilters;
  onToggleYear: (year: number) => void;
  onSetAllYears: () => void;
}

export default function StepWhen({ staged, onToggleYear, onSetAllYears }: StepWhenProps) {
  const allSelected = staged.selectedYears.size === 0;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-on-surface mb-1">When did it happen?</h3>
        <p className="text-[11px] text-on-surface-variant leading-snug">
          Select one or more years. All years shown by default.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterChip label="All Years" active={allSelected} onClick={onSetAllYears} />
        {[...YEARS].reverse().map((year) => (
          <FilterChip
            key={year}
            label={String(year)}
            active={!allSelected && staged.selectedYears.has(year)}
            onClick={() => onToggleYear(year)}
          />
        ))}
      </div>

      {!allSelected && staged.selectedYears.size > 0 && (
        <p className="text-[11px] text-on-surface-variant">
          {staged.selectedYears.size} year{staged.selectedYears.size > 1 ? "s" : ""} selected
        </p>
      )}

      {(allSelected || [...staged.selectedYears].some((y) => y >= 2016)) && (
        <div className="flex items-center gap-2 bg-tertiary-container/30 rounded-lg px-3 py-2">
          <span className="material-symbols-outlined text-[14px] text-tertiary">info</span>
          <p className="text-[10px] text-on-surface-variant">
            2016+ years unlock involvement and driver age filters in Step 3.
          </p>
        </div>
      )}
    </div>
  );
}

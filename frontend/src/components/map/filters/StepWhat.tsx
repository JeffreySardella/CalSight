import { CAUSES, SEVERITIES } from "../../../hooks/useFilterParams";
import { useCauseCounts, useSeverityCounts, fmtCount } from "../../../hooks/useFilterCounts";
import type { StagedFilters } from "../../../hooks/useStagedFilters";
import FilterChip from "./FilterChip";

interface StepWhatProps {
  staged: StagedFilters;
  onToggleCause: (cause: string) => void;
  onClearCauses: () => void;
  onToggleSeverity: (severity: string) => void;
  onClearSeverities: () => void;
}

export default function StepWhat({ staged, onToggleCause, onClearCauses, onToggleSeverity, onClearSeverities }: StepWhatProps) {
  const allCauses = staged.causes.size === 0;
  const allSeverities = staged.severities.size === 0;
  const { data: causeCounts } = useCauseCounts();
  const { data: severityCounts } = useSeverityCounts();

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-bold text-on-surface mb-1">What caused the crash?</h3>
          <p className="text-[11px] text-on-surface-variant leading-snug">
            The primary factor determined by the reporting officer.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip label="All Causes" active={allCauses} onClick={onClearCauses} />
          {CAUSES.map((cause) => (
            <FilterChip
              key={cause.value}
              label={cause.label}
              icon={cause.icon}
              count={causeCounts?.[cause.value] ? fmtCount(causeCounts[cause.value]) : undefined}
              active={!allCauses && staged.causes.has(cause.value)}
              onClick={() => onToggleCause(cause.value)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-bold text-on-surface mb-1">How severe?</h3>
          <p className="text-[11px] text-on-surface-variant leading-snug">
            The worst outcome of the crash.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip label="All Severities" active={allSeverities} onClick={onClearSeverities} />
          {SEVERITIES.map((s) => (
            <FilterChip
              key={s}
              label={s}
              count={severityCounts?.[s] ? fmtCount(severityCounts[s]) : undefined}
              active={!allSeverities && staged.severities.has(s)}
              onClick={() => onToggleSeverity(s)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

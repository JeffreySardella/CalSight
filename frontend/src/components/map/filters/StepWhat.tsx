import { CAUSES, SEVERITIES } from "../../../hooks/useFilterParams";
import type { StagedFilters } from "../../../hooks/useStagedFilters";
import FilterChip from "./FilterChip";

interface StepWhatProps {
  staged: StagedFilters;
  onToggleCause: (cause: string) => void;
  onClearCauses: () => void;
  onToggleSeverity: (severity: string) => void;
  onClearSeverities: () => void;
  causeCounts?: Record<string, number>;
  severityCounts?: Record<string, number>;
  loading?: boolean;
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString();
}

export default function StepWhat({ staged, onToggleCause, onClearCauses, onToggleSeverity, onClearSeverities, causeCounts, severityCounts, loading }: StepWhatProps) {
  const allCauses = staged.causes.size === 0;
  const allSeverities = staged.severities.size === 0;

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        {[1, 2].map((i) => (
          <div key={i} className="space-y-3">
            <div className="h-4 bg-surface-container-high rounded w-44" />
            <div className="h-3 bg-surface-container-high rounded w-60" />
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: i === 1 ? 10 : 4 }, (_, j) => (
                <div key={j} className="h-8 bg-surface-container-high rounded-full w-24" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

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
          {CAUSES.map((cause) => {
            const count = causeCounts?.[cause.value];
            const hasData = count === undefined || count > 0;
            return (
              <FilterChip
                key={cause.value}
                label={cause.label}
                icon={cause.icon}
                count={count != null ? fmtCount(count) : undefined}
                active={!allCauses && staged.causes.has(cause.value)}
                disabled={!hasData}
                onClick={() => onToggleCause(cause.value)}
              />
            );
          })}
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
          {SEVERITIES.map((s) => {
            const count = severityCounts?.[s];
            const hasData = count === undefined || count > 0;
            return (
              <FilterChip
                key={s}
                label={s}
                count={count != null ? fmtCount(count) : undefined}
                active={!allSeverities && staged.severities.has(s)}
                disabled={!hasData}
                onClick={() => onToggleSeverity(s)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

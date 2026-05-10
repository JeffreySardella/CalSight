import { INVOLVEMENTS, DRIVER_AGE_BRACKETS } from "../../../hooks/useFilterParams";
import type { StagedFilters } from "../../../hooks/useStagedFilters";
import FilterChip from "./FilterChip";

interface StepWhoProps {
  staged: StagedFilters;
  has2016Plus: boolean;
  onToggleInvolvement: (key: "alcohol" | "distracted" | "pedestrian" | "cyclist" | "drug") => void;
  onSetDriverAge: (bracket: string | null) => void;
  involvementCounts?: Record<string, number>;
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString();
}

const INV_KEYS: Record<string, keyof Pick<StagedFilters, "alcohol" | "distracted" | "pedestrian" | "cyclist" | "drug">> = {
  alcohol: "alcohol",
  distracted: "distracted",
  pedestrian: "pedestrian",
  cyclist: "cyclist",
  drug: "drug",
};

export default function StepWho({ staged, has2016Plus, onToggleInvolvement, onSetDriverAge, involvementCounts }: StepWhoProps) {
  if (!has2016Plus) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-bold text-on-surface mb-1">Who was involved?</h3>
          <p className="text-[11px] text-on-surface-variant leading-snug">
            Involvement and driver age data is only available for 2016+ crashes (CCRS).
          </p>
        </div>
        <div className="bg-surface-container rounded-xl px-4 py-6 text-center">
          <span className="material-symbols-outlined text-[32px] text-on-surface-variant/40 block mb-2">info</span>
          <p className="text-sm text-on-surface-variant">
            Select at least one year from 2016 or later in Step 1 to unlock these filters.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-bold text-on-surface mb-1">Who was involved?</h3>
          <p className="text-[11px] text-on-surface-variant leading-snug">
            Whether a specific party type was present, regardless of who was at fault. Multiple can be selected.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {INVOLVEMENTS.map((inv) => {
            const count = involvementCounts?.[inv.value];
            return (
              <FilterChip
                key={inv.value}
                label={inv.label}
                icon={inv.icon}
                count={count != null ? fmtCount(count) : undefined}
                active={staged[INV_KEYS[inv.value]]}
                disabled={count != null && count === 0}
                onClick={() => onToggleInvolvement(INV_KEYS[inv.value])}
              />
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-bold text-on-surface mb-1">At-fault driver age</h3>
          <p className="text-[11px] text-on-surface-variant leading-snug">
            Age of the driver determined to be at fault. One bracket at a time.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip label="Any Age" active={staged.driverAge === null} onClick={() => onSetDriverAge(null)} />
          {DRIVER_AGE_BRACKETS.map((b) => (
            <FilterChip
              key={b.value}
              label={b.label}
              active={staged.driverAge === b.value}
              onClick={() => onSetDriverAge(staged.driverAge === b.value ? null : b.value)}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 bg-tertiary-container/30 rounded-lg px-3 py-2">
        <span className="material-symbols-outlined text-[14px] text-tertiary">info</span>
        <p className="text-[10px] text-on-surface-variant">
          These filters use 2016+ CCRS data only. Pre-2016 crashes (SWITRS) don't have party-level details.
        </p>
      </div>
    </div>
  );
}

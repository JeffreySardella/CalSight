import type { DrillState } from "../../hooks/useDrillDown";

interface Props {
  drillState: DrillState;
  onDrillUp: () => void;
}

/**
 * Breadcrumb showing the current drill-down path.
 * Only renders when drilled into a county.
 */
export default function DrillBreadcrumb({ drillState, onDrillUp }: Props) {
  if (drillState.level === "state") return null;

  return (
    <nav aria-label="Drill-down breadcrumb" className="flex items-center gap-1 text-sm overflow-hidden min-w-0">
      <button
        type="button"
        onClick={onDrillUp}
        className="text-primary font-semibold hover:underline focus:outline-2 focus:outline-primary/50 min-h-[44px] flex items-center flex-shrink-0"
      >
        California
      </button>
      <span className="material-symbols-outlined text-[16px] text-on-surface-variant flex-shrink-0" aria-hidden="true">
        chevron_right
      </span>
      <span className="text-on-surface font-semibold truncate">
        {drillState.county} County
      </span>
    </nav>
  );
}

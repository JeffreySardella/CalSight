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
    <nav aria-label="Drill-down breadcrumb" className="flex items-center gap-1 text-sm">
      <button
        type="button"
        onClick={onDrillUp}
        className="text-primary font-semibold hover:underline focus:outline-2 focus:outline-primary/50"
      >
        California
      </button>
      <span className="material-symbols-outlined text-[16px] text-on-surface-variant" aria-hidden="true">
        chevron_right
      </span>
      <span className="text-on-surface font-semibold">
        {drillState.county} County
      </span>
    </nav>
  );
}

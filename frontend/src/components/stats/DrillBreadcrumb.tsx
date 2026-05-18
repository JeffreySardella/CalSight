import { Link, useSearchParams } from "react-router-dom";
import type { DrillState } from "../../hooks/useDrillDown";
import { buildFilterQS, slugify } from "../../hooks/useFilterParams";

interface Props {
  drillState: DrillState;
  onDrillUp: () => void;
}

/**
 * Breadcrumb showing the current drill-down path.
 * Only renders when drilled into a county.
 */
export default function DrillBreadcrumb({ drillState, onDrillUp }: Props) {
  const [searchParams] = useSearchParams();

  if (drillState.level === "state") return null;

  // Build "Show on Map" link: /?county=slug + active filters (minus drill_county)
  const countySlug = slugify(drillState.county!);
  const filterQs = buildFilterQS(searchParams);
  const extra = new URLSearchParams(filterQs);
  extra.delete("county"); // we set county explicitly
  const tail = extra.toString();
  const mapHref = `/?county=${countySlug}${tail ? `&${tail}` : ""}`;

  return (
    <nav aria-label="Drill-down breadcrumb" className="flex items-center gap-1 text-sm overflow-hidden min-w-0 bg-primary/10 rounded-lg px-3 py-2">
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
      <Link
        to={mapHref}
        className="ml-auto flex items-center gap-1 text-primary text-xs font-semibold hover:underline focus:outline-2 focus:outline-primary/50 min-h-[44px] flex-shrink-0"
        aria-label={`Show ${drillState.county} County on map`}
      >
        <span className="material-symbols-outlined text-[16px]">map</span>
        Show on Map
      </Link>
    </nav>
  );
}

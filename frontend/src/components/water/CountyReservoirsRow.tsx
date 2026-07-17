import { Link } from "react-router-dom";
import {
  formatAcreFeet,
  useReservoirConditions,
} from "../../hooks/useWaterData";

interface CountyReservoirsRowProps {
  countyName: string;
  /** Numeric county code, resolved upstream by the map page. */
  countyCode: number | undefined;
}

/**
 * The county's major reservoirs with today's percent of capacity — lives
 * inside the map's county insight card, right under the drought row and
 * following its visual conventions. Self-contained fetch of the shared
 * reservoir-conditions query (deduped with the map layer and /water page);
 * renders nothing when the county has no tracked reservoir, when the code
 * is unresolved, or before data exists.
 */
export default function CountyReservoirsRow({ countyName, countyCode }: CountyReservoirsRowProps) {
  const { data: reservoirs } = useReservoirConditions();

  // /api/water/reservoirs is already sorted by capacity, largest first.
  const inCounty = (reservoirs ?? []).filter(
    (r) => countyCode !== undefined && r.county_code === countyCode,
  );
  if (inCounty.length === 0) return null;

  return (
    <div className="bg-surface-container-low/50 px-3 py-2.5 rounded-lg space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="material-symbols-outlined text-[16px] text-on-surface-variant shrink-0"
            aria-hidden="true"
          >
            water
          </span>
          <span className="text-[10px] text-on-surface-variant font-bold uppercase tracking-widest">
            Reservoirs
          </span>
        </div>
        <Link
          to="/water"
          className="text-[10px] text-primary font-semibold shrink-0 hover:opacity-80 transition-opacity"
        >
          Water →
        </Link>
      </div>
      <ul className="space-y-1" aria-label={`${countyName} County reservoirs`}>
        {inCounty.map((r) => (
          <li key={r.station_id} className="flex items-center gap-2">
            <span className="text-xs text-on-surface font-medium truncate flex-1">
              {r.name}
            </span>
            <span
              role="img"
              aria-label={`${r.name}: ${r.pct_of_capacity.toFixed(0)}% of capacity`}
              title={`${formatAcreFeet(r.storage_af)} of ${formatAcreFeet(r.capacity_af)} acre-feet`}
              className="relative h-1.5 w-16 bg-surface-container-high rounded-full overflow-hidden shrink-0"
            >
              <span
                className="absolute inset-y-0 left-0 bg-primary rounded-full"
                style={{ width: `${Math.min(r.pct_of_capacity, 100)}%` }}
              />
            </span>
            <span className="text-xs text-on-surface-variant tabular-nums w-9 text-right shrink-0">
              {r.pct_of_capacity.toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

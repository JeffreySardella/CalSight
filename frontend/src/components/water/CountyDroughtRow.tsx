import { Link } from "react-router-dom";
import { inDroughtPct, useDroughtSnapshot } from "../../hooks/useDroughtData";
import { SeverityBar } from "./DroughtSection";

interface CountyDroughtRowProps {
  countyName: string;
  /** Numeric county code, resolved upstream by the map page. */
  countyCode: number | undefined;
}

/**
 * Compact drought status for one county — lives inside the map's county
 * insight card. Self-contained fetch of the shared drought snapshot;
 * renders nothing until data exists (so the card is unchanged on
 * deployments that haven't loaded USDM data yet) or when the county
 * code couldn't be resolved.
 */
export default function CountyDroughtRow({ countyName, countyCode }: CountyDroughtRowProps) {
  const { data: snapshot } = useDroughtSnapshot();

  const county = snapshot?.counties.find((c) => c.county_code === countyCode);
  if (!county) return null;

  const drought = inDroughtPct(county);

  return (
    <div className="bg-surface-container-low/50 px-3 py-2.5 rounded-lg space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="material-symbols-outlined text-[16px] text-on-surface-variant shrink-0"
            aria-hidden="true"
          >
            water_drop
          </span>
          <span className="text-[10px] text-on-surface-variant font-bold uppercase tracking-widest">
            Drought
          </span>
          <span className="text-xs text-on-surface font-medium truncate">
            {drought >= 0.5
              ? `${drought.toFixed(0)}% in drought (D1+)`
              : "No drought this week"}
          </span>
        </div>
        <Link
          to="/water"
          className="text-[10px] text-primary font-semibold shrink-0 hover:opacity-80 transition-opacity"
        >
          Water →
        </Link>
      </div>
      <SeverityBar
        pcts={county}
        label={`${countyName} County drought severity`}
        height="h-1.5"
      />
    </div>
  );
}

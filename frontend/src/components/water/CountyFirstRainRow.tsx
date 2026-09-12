import { Link } from "react-router-dom";
import { formatDay, formatLift, useFirstRain } from "../../hooks/useFirstRain";

interface CountyFirstRainRowProps {
  /** Numeric county code, resolved upstream by the map page. */
  countyCode: number | undefined;
}

/**
 * Days since measurable rain plus the county's latest first-storm crash
 * lift — lives inside the map's county insight card under the drought and
 * reservoir rows and follows their conventions. Renders nothing when the
 * county has neither datum, the code is unresolved, or /api/first-rain
 * isn't there yet (the hook maps 404 to null).
 */
export default function CountyFirstRainRow({ countyCode }: CountyFirstRainRowProps) {
  const { data } = useFirstRain();

  const event = data?.counties.find((c) => c.county_code === countyCode);
  const days = data?.days_since_rain.find((c) => c.county_code === countyCode)?.days ?? null;
  if (!event && days === null) return null;

  return (
    <div className="bg-surface-container-low/50 px-3 py-2.5 rounded-lg space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="material-symbols-outlined text-[16px] text-on-surface-variant shrink-0"
            aria-hidden="true"
          >
            rainy
          </span>
          <span className="text-[10px] text-on-surface-variant font-bold uppercase tracking-widest">
            First rain
          </span>
          {days !== null && (
            <span className="text-xs text-on-surface font-medium truncate">
              {days === 0
                ? "Rain in the last day"
                : `${days} day${days === 1 ? "" : "s"} since measurable rain`}
            </span>
          )}
        </div>
        <Link
          to="/water"
          className="text-[10px] text-primary font-semibold shrink-0 hover:opacity-80 transition-opacity"
        >
          Water →
        </Link>
      </div>
      {event && (
        <p className="text-xs text-on-surface-variant leading-snug">
          {`First storm of WY${event.water_year} (${formatDay(event.first_rain_date)}): ` +
            `${event.crashes_on_day} crashes vs ${event.baseline_daily_crashes.toFixed(1)}/day` +
            (event.lift_pct != null ? `, ${formatLift(event.lift_pct)}` : "") +
            (event.small_baseline ? " (small numbers)" : "")}
        </p>
      )}
    </div>
  );
}

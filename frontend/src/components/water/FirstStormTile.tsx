import { Link } from "react-router-dom";
import Sparkline from "../charts/Sparkline";
import { formatDay, formatLift, useFirstRain } from "../../hooks/useFirstRain";

/** "Gone this long without rain" threshold for the dry-county count. */
const DRY_DAYS = 30;

/**
 * The bridge between the Water page and crash data: how much busier the
 * first rainy day of each water year is than the dry month before it.
 * Self-contained fetch; renders nothing while loading and whenever the
 * /api/first-rain endpoint is missing or failing, like the other water
 * sections.
 */
export default function FirstStormTile() {
  const { data } = useFirstRain();
  if (!data || data.statewide.events.length === 0) return null;

  const { statewide, days_since_rain, weather_through } = data;
  const latest = statewide.events[statewide.events.length - 1];
  const lift = statewide.median_lift_pct;
  const dry = days_since_rain.filter((d) => d.days >= DRY_DAYS).length;

  return (
    <section
      aria-label="First storm"
      className="bg-surface-container-lowest rounded-2xl p-6 md:p-8 ambient-shadow mb-12"
    >
      <span className="font-label text-xs uppercase tracking-[0.3em] text-on-surface-variant block mb-4">
        Why water is a road-safety story
      </span>

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <p
          className={`text-4xl md:text-5xl font-headline font-bold tracking-tight ${
            lift > 0 ? "text-error" : "text-on-surface"
          }`}
        >
          {formatLift(lift)}
        </p>
        <p className="text-on-surface-variant max-w-xl leading-relaxed">
          more crashes on the first rainy day of the water year than in the dry
          4 weeks before it (median of {statewide.water_years} water years,{" "}
          {latest.counties} counties)
        </p>
      </div>

      <p className="mt-4 text-on-surface">
        Water year {latest.water_year}: first storms landed around{" "}
        {formatDay(latest.median_first_rain_date)};{" "}
        {latest.crashes_on_first_rain_days.toLocaleString()} crashes vs{" "}
        {Math.round(latest.baseline_expected).toLocaleString()} expected (
        {formatLift(latest.lift_pct)})
      </p>
      <p className="mt-1 text-on-surface-variant">
        {dry > 0
          ? `${dry} ${dry === 1 ? "county has" : "counties have"} gone ${DRY_DAYS}+ days without measurable rain as of ${formatDay(weather_through)}`
          : `Every county has seen measurable rain in the last ${DRY_DAYS} days`}
      </p>

      <div className="mt-6 flex items-center gap-3">
        <Sparkline
          data={statewide.events.map((e) => e.lift_pct)}
          width={160}
          height={36}
          color="rgb(var(--error))"
          label="First-storm effect by water year"
        />
        <span className="text-[10px] text-on-surface-variant uppercase tracking-widest">
          First-storm effect by water year
        </span>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-on-surface-variant">
          Rain = nClimGrid county-average precipitation ≥ {data.threshold_in.toFixed(2)} in
          after ≥ {data.min_dry_days} dry days; baseline = the {data.baseline_days} days
          before. Association, not causation.
        </p>
        <Link
          to="/stats?story=first-storm"
          className="text-sm text-primary font-medium hover:underline whitespace-nowrap"
        >
          See the story →
        </Link>
      </div>
    </section>
  );
}

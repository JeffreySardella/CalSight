import { useSnowpack, type RegionSnowpack } from "../../hooks/useSnowpackData";

/** Percent-of-average → a bar fill fraction, capped at 200% so a huge
 * snow year doesn't blow out the layout. */
function barFraction(pct: number): number {
  return Math.min(pct, 200) / 200;
}

function RegionRow({ region }: { region: RegionSnowpack }) {
  const pct = region.pct_of_average;
  return (
    <div className="grid grid-cols-[10rem_1fr_4rem] items-center gap-3">
      <div className="min-w-0">
        <p className="text-sm text-on-surface truncate">{region.region}</p>
        <p className="text-[10px] text-on-surface-variant">
          {region.swe_in.toFixed(1)}″ SWE · {region.station_count} stations
        </p>
      </div>
      <div
        className="relative h-2 bg-surface-container-high rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={pct != null ? Math.round(pct) : undefined}
        aria-valuemin={0}
        aria-valuemax={200}
        aria-label={`${region.region}: ${pct != null ? `${pct.toFixed(0)}% of average` : "no comparison available"}`}
      >
        {pct != null && (
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${barFraction(pct) * 100}%` }}
          />
        )}
        {/* 100%-of-average reference tick */}
        <div
          aria-hidden="true"
          className="absolute top-0 h-full w-0.5 bg-on-surface"
          style={{ left: "50%" }}
          title="100% of average"
        />
      </div>
      <span className="text-xs text-on-surface-variant text-right tabular-nums">
        {pct != null ? `${pct.toFixed(0)}%` : "—"}
      </span>
    </div>
  );
}

/**
 * Sierra snowpack by region — current snow water equivalent as a percent
 * of the same-day-of-year average. Self-contained fetch; renders nothing
 * until CDEC snow data is loaded.
 */
export default function SnowpackSection() {
  const { data, isError } = useSnowpack();

  // A failed fetch is not the same as "no data loaded yet" (404 → null):
  // the section must not silently vanish on an outage.
  if (isError) {
    return (
      <section aria-label="Snowpack conditions" className="mt-20 max-w-2xl mx-auto">
        <p role="alert" className="text-center text-error py-8">
          Couldn&rsquo;t load snowpack conditions. Please try again shortly.
        </p>
      </section>
    );
  }

  if (!data) return null;

  const statewide = data.statewide_pct_of_average;

  return (
    <section aria-label="Snowpack conditions" className="mt-20 max-w-2xl mx-auto">
      <span className="font-label text-xs uppercase tracking-[0.3em] text-on-surface-variant block text-center">
        Sierra snowpack · {data.latest_date}
      </span>
      <h2 className="font-headline text-3xl md:text-4xl font-bold tracking-tighter text-on-surface text-center mt-4">
        {statewide != null
          ? `Statewide snowpack is ${statewide.toFixed(0)}% of average`
          : "Sierra snowpack by region"}
      </h2>
      <p className="text-on-surface-variant text-center mt-3">
        Snow water equivalent vs. the average for this day of year, by DWR
        region. The tick marks 100% of average.
      </p>

      <div className="mt-8 space-y-4">
        {data.regions.map((r) => (
          <RegionRow key={r.region} region={r} />
        ))}
      </div>

      <p className="text-xs text-on-surface-variant text-center mt-8">
        Source: California Department of Water Resources, California Data
        Exchange Center (CDEC) snow sensors. Snow water equivalent in inches;
        percent of average is relative to the mean for this calendar day
        across all loaded years.
      </p>
    </section>
  );
}

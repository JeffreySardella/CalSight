import { useSnowpack, type RegionSnowpack } from "../../hooks/useSnowpackData";

/** Percent-of-average → a bar fill fraction, capped at 200% so a huge
 * snow year doesn't blow out the layout. */
function barFraction(pct: number): number {
  return Math.min(pct, 200) / 200;
}

/** DWR convention: during the melt season (April–September) the number
 * that matters is how this season's April 1 snapshot compared to the
 * April-1 average — the same-date percent degenerates as the denominator
 * melts toward zero (a July "9% of a 1.8-inch average" is noise). */
function isMeltSeason(latestDate: string): boolean {
  const month = Number(latestDate.slice(5, 7));
  return month >= 4 && month <= 9;
}

function RegionRow({ region, melt }: { region: RegionSnowpack; melt: boolean }) {
  const pct = melt ? region.apr1_pct_of_average : region.pct_of_average;
  const detail = melt
    ? region.apr1_swe_in != null
      ? `April 1: ${region.apr1_swe_in.toFixed(1)}″ SWE · now ${region.swe_in.toFixed(1)}″`
      : `now ${region.swe_in.toFixed(1)}″ SWE · ${region.station_count} station${region.station_count === 1 ? "" : "s"}`
    : `${region.swe_in.toFixed(1)}″ SWE · ${region.station_count} station${region.station_count === 1 ? "" : "s"}`;
  const pctLabel = melt ? "% of April 1 average" : "% of average";
  return (
    <div className="grid grid-cols-[10rem_1fr_4rem] items-center gap-3">
      <div className="min-w-0">
        <p className="text-sm text-on-surface truncate">{region.region}</p>
        <p className="text-[10px] text-on-surface-variant">{detail}</p>
      </div>
      <div
        className="relative h-2 bg-surface-container-high rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={pct != null ? Math.round(pct) : undefined}
        aria-valuemin={0}
        aria-valuemax={200}
        aria-label={`${region.region}: ${pct != null ? `${pct.toFixed(0)}${pctLabel}` : "no comparison available"}`}
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
 * Sierra snowpack by region. In the accumulation season (Oct–Mar) this is
 * current SWE as a percent of the same-day-of-year average — DWR's
 * in-season headline. In the melt season (Apr–Sep) it switches to the
 * season-defining "% of April 1 average". Self-contained fetch; renders
 * nothing until CDEC snow data is loaded.
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

  // Melt-season display needs the April-1 figures to exist; fall back to
  // the same-date presentation when they don't (e.g. sparse history).
  const melt = isMeltSeason(data.latest_date) && data.statewide_apr1_pct_of_average != null;
  const statewide = melt
    ? data.statewide_apr1_pct_of_average
    : data.statewide_pct_of_average;

  return (
    <section aria-label="Snowpack conditions" className="mt-20 max-w-2xl mx-auto">
      <span className="font-label text-xs uppercase tracking-[0.3em] text-on-surface-variant block text-center">
        Sierra snowpack · {melt && data.apr1_date ? `April 1 (${data.apr1_date.slice(0, 4)}) snapshot` : data.latest_date}
      </span>
      <h2 className="font-headline text-3xl md:text-4xl font-bold tracking-tighter text-on-surface text-center mt-4">
        {statewide != null
          ? melt
            ? `April 1 snowpack was ${statewide.toFixed(0)}% of average`
            : `Statewide snowpack is ${statewide.toFixed(0)}% of average`
          : "Sierra snowpack by region"}
      </h2>
      <p className="text-on-surface-variant text-center mt-3">
        {melt
          ? "How this season's April 1 snowpack — the typical peak — compared to the April 1 average, by DWR region. The tick marks 100%."
          : "Snow water equivalent vs. the average for this day of year, by DWR region. The tick marks 100% of average."}
      </p>

      <div className="mt-8 space-y-4">
        {data.regions.map((r) => (
          <RegionRow key={r.region} region={r} melt={melt} />
        ))}
      </div>

      <p className="text-xs text-on-surface-variant text-center mt-8">
        Source: California Department of Water Resources, California Data
        Exchange Center (CDEC) snow sensors. Snow water equivalent in inches;
        averages are computed per calendar day across all loaded years.
      </p>
    </section>
  );
}

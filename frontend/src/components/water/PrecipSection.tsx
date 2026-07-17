import { usePrecipIndices, type PrecipIndex } from "../../hooks/usePrecipData";

/** Percent-of-average → a bar fill fraction, capped at 200% so a huge wet
 * year doesn't blow out the layout (mirrors SnowpackSection). */
function barFraction(pct: number): number {
  return Math.min(pct, 200) / 200;
}

/** The 8-Station Index (Northern Sierra) is the marquee California
 * wet-season number, so it drives the section headline. */
const HEADLINE_INDEX = "8SI";

function IndexRow({ index }: { index: PrecipIndex }) {
  const pct = index.pct_of_average;
  return (
    <div className="grid grid-cols-[10rem_1fr_4rem] items-center gap-3">
      <div className="min-w-0">
        <p className="text-sm text-on-surface truncate">{index.region}</p>
        <p className="text-[10px] text-on-surface-variant">
          {index.accum_in.toFixed(1)}″ so far this water year
        </p>
      </div>
      <div
        className="relative h-2 bg-surface-container-high rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={pct != null ? Math.round(pct) : undefined}
        aria-valuemin={0}
        aria-valuemax={200}
        aria-label={`${index.region}: ${pct != null ? `${pct.toFixed(0)}% of average` : "no comparison available"}`}
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
 * DWR's three regional precipitation indices (8SI/5SI/6SI) as accumulated
 * water-year precipitation versus the average for this day of year. The
 * 8-Station Index headlines. Self-contained fetch; renders nothing until CDEC
 * precip-index data is loaded.
 */
export default function PrecipSection() {
  const { data, isError } = usePrecipIndices();

  // A failed fetch is not the same as "no data loaded yet" (404 → null): the
  // section must not silently vanish on an outage.
  if (isError) {
    return (
      <section aria-label="Precipitation indices" className="mt-20 max-w-2xl mx-auto">
        <p role="alert" className="text-center text-error py-8">
          Couldn&rsquo;t load precipitation conditions. Please try again shortly.
        </p>
      </section>
    );
  }

  if (!data || data.length === 0) return null;

  const headline = data.find((d) => d.station_id === HEADLINE_INDEX);
  const headlinePct =
    headline != null ? headline.pct_of_average : null;
  const latestDate = data[0].latest_date;

  return (
    <section aria-label="Precipitation indices" className="mt-20 max-w-2xl mx-auto">
      <span className="font-label text-xs uppercase tracking-[0.3em] text-on-surface-variant block text-center">
        Sierra precipitation · {latestDate}
      </span>
      <h2 className="font-headline text-3xl md:text-4xl font-bold tracking-tighter text-on-surface text-center mt-4">
        {headlinePct != null
          ? `The 8-Station Index is ${headlinePct.toFixed(0)}% of average`
          : "Sierra precipitation by index"}
      </h2>
      <p className="text-on-surface-variant text-center mt-3">
        Accumulated precipitation since October 1 vs. the average for this day
        of the water year, by DWR index. The tick marks 100% of average.
      </p>

      <div className="mt-8 space-y-4">
        {data.map((index) => (
          <IndexRow key={index.station_id} index={index} />
        ))}
      </div>

      <p className="text-xs text-on-surface-variant text-center mt-8">
        Source: California Department of Water Resources, California Data
        Exchange Center (CDEC) precipitation indices. Accumulated inches since
        October 1; averages are computed per calendar day across all loaded
        years.
      </p>
    </section>
  );
}

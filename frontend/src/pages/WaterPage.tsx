import MetaTags from "../components/seo/MetaTags";
import DroughtSection from "../components/water/DroughtSection";
import ReservoirCard from "../components/water/ReservoirCard";
import SnowpackSection from "../components/water/SnowpackSection";
import {
  formatAcreFeet,
  summarize,
  useReservoirConditions,
} from "../hooks/useWaterData";

export default function WaterPage() {
  const { data, isLoading, isError } = useReservoirConditions();
  const summary = data ? summarize(data) : null;

  return (
    <main className="max-w-[1100px] mx-auto px-6 pb-24">
      <MetaTags
        title="Water — CalSight"
        description="Current storage conditions at California's major reservoirs — percent of capacity and of historical average, from DWR's California Data Exchange Center."
        path="/water"
      />

      <section className="py-16 md:py-24 text-center">
        <span className="font-label text-xs uppercase tracking-[0.3em] text-on-surface-variant block mb-6">
          Water conditions
        </span>
        <h1 className="font-headline text-4xl md:text-6xl font-bold tracking-tighter text-on-surface mb-6">
          California&rsquo;s Reservoirs
        </h1>
        <p className="font-body text-lg text-on-surface-variant max-w-2xl mx-auto leading-relaxed">
          Daily storage at the state&rsquo;s major reservoirs, measured against
          both total capacity and the historical average for this day of year.
        </p>
      </section>

      {isLoading && (
        <p role="status" className="text-center text-on-surface-variant py-16">
          Loading reservoir conditions…
        </p>
      )}

      {isError && (
        <p role="alert" className="text-center text-error py-16">
          Couldn&rsquo;t load reservoir data. Please try again shortly.
        </p>
      )}

      {data && data.length === 0 && (
        <p className="text-center text-on-surface-variant py-16">
          No reservoir data has been loaded yet.
        </p>
      )}

      {summary && (
        <section
          aria-label="Statewide summary"
          className="bg-surface-container-low rounded-3xl px-8 py-10 mb-12 grid grid-cols-1 sm:grid-cols-3 gap-8 text-center"
        >
          <div>
            <p className="text-3xl md:text-4xl font-headline font-bold text-on-surface tracking-tight">
              {formatAcreFeet(summary.totalStorageAf)}
            </p>
            <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mt-2">
              acre-feet in storage
            </p>
          </div>
          <div>
            <p className="text-3xl md:text-4xl font-headline font-bold text-on-surface tracking-tight">
              {summary.pctOfCapacity.toFixed(0)}%
            </p>
            <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mt-2">
              of combined capacity
            </p>
          </div>
          <div>
            <p className="text-3xl md:text-4xl font-headline font-bold text-on-surface tracking-tight">
              {summary.pctOfAverage !== null ? `${summary.pctOfAverage.toFixed(0)}%` : "—"}
            </p>
            <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mt-2">
              of historical average
            </p>
          </div>
          {/* Stale feeds are dropped from the totals (recency cutoff), so
              the station count is the honest disclosure of what the
              numbers above are built from. */}
          {data && (
            <p className="sm:col-span-3 text-[10px] text-on-surface-variant uppercase tracking-widest">
              Based on {data.length} reservoir{data.length === 1 ? "" : "s"} reporting
            </p>
          )}
        </section>
      )}

      {data && data.length > 0 && (
        <section
          aria-label="Reservoirs"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {data.map((r) => (
            <ReservoirCard key={r.station_id} reservoir={r} />
          ))}
        </section>
      )}

      <p className="text-xs text-on-surface-variant text-center mt-16">
        Source: California Department of Water Resources, California Data
        Exchange Center (CDEC). Storage in acre-feet; historical average is the
        mean for this calendar day across all loaded years.
      </p>

      <SnowpackSection />

      <DroughtSection />
    </main>
  );
}

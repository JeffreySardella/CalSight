import { useState } from "react";
import Sparkline from "../charts/Sparkline";
import {
  formatAcreFeet,
  useReservoirSeries,
  type ReservoirCondition,
} from "../../hooks/useWaterData";

interface ReservoirCardProps {
  reservoir: ReservoirCondition;
}

/**
 * One reservoir "ledger entry": current storage against capacity, with a
 * tick marking the historical average for this day of year. Expands to a
 * one-year storage sparkline on demand.
 */
export default function ReservoirCard({ reservoir }: ReservoirCardProps) {
  const [expanded, setExpanded] = useState(false);
  const series = useReservoirSeries(expanded ? reservoir.station_id : null);

  const pctCapacity = Math.min(reservoir.pct_of_capacity, 100);
  const avgPctOfCapacity =
    reservoir.avg_storage_af !== null
      ? Math.min((reservoir.avg_storage_af / reservoir.capacity_af) * 100, 100)
      : null;

  return (
    <article className="bg-surface-container-lowest rounded-2xl p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="font-headline font-bold text-on-surface text-lg leading-tight">
          {reservoir.name}
        </h3>
        <span className="font-label text-[10px] uppercase tracking-[0.2em] text-on-surface-variant shrink-0">
          {reservoir.station_id}
        </span>
      </div>

      <div className="flex items-end justify-between mt-4 mb-3">
        <div>
          <p className="text-4xl font-headline font-bold text-on-surface tracking-tight">
            {reservoir.pct_of_capacity.toFixed(0)}
            <span className="text-xl text-on-surface-variant">%</span>
          </p>
          <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mt-1">
            of capacity
          </p>
        </div>
        {reservoir.pct_of_average !== null && (
          <div className="text-right">
            <p className="text-lg font-headline font-semibold text-on-surface">
              {reservoir.pct_of_average.toFixed(0)}%
            </p>
            <p className="text-[10px] text-on-surface-variant uppercase tracking-widest">
              of avg for today
            </p>
          </div>
        )}
      </div>

      <div
        className="relative h-2 bg-surface-container-high rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(reservoir.pct_of_capacity)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${reservoir.name}: ${reservoir.pct_of_capacity.toFixed(0)}% of capacity`}
      >
        <div
          className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${pctCapacity}%` }}
        />
        {avgPctOfCapacity !== null && (
          <div
            data-testid="avg-tick"
            className="absolute top-0 h-full w-0.5 bg-on-surface"
            style={{ left: `${avgPctOfCapacity}%` }}
            title={`Historical average: ${formatAcreFeet(reservoir.avg_storage_af!)} AF`}
          />
        )}
      </div>

      <p className="text-xs text-on-surface-variant mt-3">
        {formatAcreFeet(reservoir.storage_af)} of {formatAcreFeet(reservoir.capacity_af)}{" "}
        acre-feet · {reservoir.latest_date}
      </p>

      <button
        type="button"
        className="mt-3 text-xs font-medium text-primary hover:opacity-80 transition-opacity"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? "Hide past year" : "Show past year"}
      </button>

      {expanded && (
        <div className="mt-2 min-h-[64px]">
          {series.isLoading && (
            <p className="text-xs text-on-surface-variant">Loading…</p>
          )}
          {series.isError && (
            <p className="text-xs text-error">Couldn&rsquo;t load the time series.</p>
          )}
          {series.data && series.data.points.length > 1 && (
            <Sparkline
              data={series.data.points.map((p) => p.storage_af)}
              width={260}
              height={56}
              upIsGood
              showEndDot
              label={`${reservoir.name} storage over the past year`}
              className="w-full"
            />
          )}
          {series.data && series.data.points.length <= 1 && (
            <p className="text-xs text-on-surface-variant">
              Not enough history yet.
            </p>
          )}
        </div>
      )}
    </article>
  );
}

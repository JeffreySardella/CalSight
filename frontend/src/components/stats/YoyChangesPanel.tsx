import { useState } from "react";
import { useYoyChanges, type YoyMetric, type CountyChange } from "../../hooks/useYoyChanges";
import { Skeleton } from "../ui/Skeleton";
import { EmptyState } from "../ui/EmptyState";
import { ErrorState } from "../ui/ErrorState";

const METRICS: { value: YoyMetric; label: string }[] = [
  { value: "crashes", label: "Crashes" },
  { value: "fatal_crashes", label: "Fatal crashes" },
  { value: "killed", label: "Killed" },
  { value: "injured", label: "Injured" },
];

function pctLabel(row: CountyChange): string {
  if (row.pct_change == null) return "—";
  const sign = row.pct_change > 0 ? "+" : "";
  return `${sign}${row.pct_change}%`;
}

// Direction is conveyed by an arrow icon AND an explicit +/- sign, never color
// alone. Neutral: "up"/"down"/"no change", not "worse"/"better".
function DirectionIcon({ change }: { change: number }) {
  if (change === 0) {
    return (
      <span className="material-symbols-outlined text-[16px] text-on-surface-variant" aria-hidden="true">
        remove
      </span>
    );
  }
  const up = change > 0;
  return (
    <span
      className="material-symbols-outlined text-[16px] text-on-surface-variant"
      aria-hidden="true"
    >
      {up ? "arrow_upward" : "arrow_downward"}
    </span>
  );
}

export default function YoyChangesPanel() {
  const [metric, setMetric] = useState<YoyMetric>("crashes");
  const { data, isLoading, error, refetch } = useYoyChanges({ metric });

  const rows = data?.rows ?? [];
  const metricLabel = METRICS.find((m) => m.value === metric)?.label ?? "Crashes";

  return (
    <section className="space-y-3" aria-label="Year-over-year change by county">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-on-surface font-headline">
            Biggest year-over-year changes
          </h2>
          <p className="text-[11px] text-on-surface-variant mt-0.5">
            {data
              ? `${metricLabel} · ${data.baseline_year} → ${data.year}${data.partial_year ? " (year in progress)" : ""}`
              : `${metricLabel} · by county`}
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="Metric"
          className="flex gap-1 rounded-lg bg-surface-container p-1 flex-wrap"
        >
          {METRICS.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={metric === m.value}
              onClick={() => setMetric(m.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                metric === m.value
                  ? "bg-primary-container text-on-primary-container"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </header>

      {isLoading ? (
        <div className="space-y-1.5" aria-busy="true" aria-label="Loading results">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : error ? (
        <ErrorState
          className="py-10"
          title="Couldn't load results"
          description="The server may be temporarily unavailable. Please try again."
          onRetry={() => refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState className="py-10" icon="table_rows" description="No county changes to show." />
      ) : (
        <div className="overflow-x-auto rounded-lg bg-surface-container-lowest ghost-border">
          <table className="w-full text-xs">
            <caption className="sr-only">
              Counties ranked by year-over-year change in {metricLabel}
            </caption>
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-on-surface-variant">
                <th scope="col" className="text-left px-3 py-2 font-bold">County</th>
                <th scope="col" className="text-right px-3 py-2 font-bold">{data?.baseline_year ?? "Prev"}</th>
                <th scope="col" className="text-right px-3 py-2 font-bold">{data?.year ?? "Latest"}</th>
                <th scope="col" className="text-right px-3 py-2 font-bold">Change</th>
                <th scope="col" className="text-right px-3 py-2 font-bold">%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.county_code}
                  className="border-t border-outline-variant/20 hover:bg-surface-container/40 transition-colors"
                >
                  <th scope="row" className="px-3 py-2 text-left font-bold text-on-surface">
                    {r.county_name ?? `County ${r.county_code}`}
                    {r.small_baseline && (
                      <span
                        className="ml-1.5 text-[10px] font-normal text-on-surface-variant"
                        title={`Baseline below ${data?.min_baseline}; percent change is noise-prone`}
                      >
                        (small baseline)
                      </span>
                    )}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums text-on-surface-variant">
                    {r.previous.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-on-surface-variant">
                    {r.current.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-on-surface">
                    <span className="inline-flex items-center gap-0.5 justify-end">
                      <DirectionIcon change={r.abs_change} />
                      {r.abs_change > 0 ? "+" : ""}
                      {r.abs_change.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-on-surface">
                    {pctLabel(r)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-on-surface-variant leading-relaxed">
        Counties with a small baseline (below {data?.min_baseline ?? "the metric minimum"} in the
        earlier year) are marked and ranked after the rest — a large percent change on a few crashes
        is statistically unreliable.
        {data?.partial_year && " The latest year is still accumulating data, so its counts are incomplete."}
      </p>
    </section>
  );
}

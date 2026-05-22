import { useState } from "react";
import { useHighwayRankings, type HighwaySort, type HighwayRow } from "../../hooks/useHighwayRankings";
import type { StatsFilters } from "../../hooks/useStats";

interface HighwayRankingsTableProps {
  filters: StatsFilters;
}

const SORT_LABELS: Record<HighwaySort, string> = {
  crash_count: "Total crashes",
  fatality_rate: "Fatality rate",
  crashes_per_mile: "Crashes per mile",
};

const SORT_HELP: Record<HighwaySort, string> = {
  crash_count: "Most crashes overall",
  fatality_rate: "Deadliest — fatalities ÷ crashes",
  crashes_per_mile: "Densest — crashes ÷ centerline miles",
};

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString();
}

function fmtRate(rate: number): string {
  // 0.012 → "1.2%"
  return `${(rate * 100).toFixed(2)}%`;
}

function fmtPerMile(v: number | null): string {
  if (v == null) return "—";
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export default function HighwayRankingsTable({ filters }: HighwayRankingsTableProps) {
  const [sort, setSort] = useState<HighwaySort>("crash_count");
  const { data, isLoading, error } = useHighwayRankings(filters, sort, 20);

  return (
    <section className="space-y-3">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-on-surface font-headline">Most dangerous highways</h2>
          <p className="text-[11px] text-on-surface-variant mt-0.5">{SORT_HELP[sort]}</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-surface-container p-1" role="tablist" aria-label="Highway sort">
          {(Object.keys(SORT_LABELS) as HighwaySort[]).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={sort === s}
              onClick={() => setSort(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                sort === s
                  ? "bg-primary-container text-on-primary-container"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {SORT_LABELS[s]}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="text-xs text-error" role="alert">Failed to load highway rankings.</div>
      )}

      {isLoading ? (
        <div className="space-y-1.5" aria-busy="true" aria-label="Loading highway rankings">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 rounded-md bg-surface-container animate-pulse" />
          ))}
        </div>
      ) : (
        <Table rows={data ?? []} sort={sort} />
      )}
    </section>
  );
}

function Table({ rows, sort }: { rows: HighwayRow[]; sort: HighwaySort }) {
  if (rows.length === 0) {
    return (
      <div className="text-xs text-on-surface-variant px-3 py-6 text-center bg-surface-container rounded-lg">
        No highway crashes match the current filters.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg bg-surface-container-lowest ghost-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-on-surface-variant">
            <th className="text-left px-3 py-2 font-bold">Rank</th>
            <th className="text-left px-3 py-2 font-bold">Highway</th>
            <th className="text-right px-3 py-2 font-bold">Crashes</th>
            <th className="text-right px-3 py-2 font-bold">Fatality rate</th>
            <th className="text-right px-3 py-2 font-bold">Per mile</th>
            <th className="text-right px-3 py-2 font-bold">Miles</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.route_number}
              className="border-t border-outline-variant/20 hover:bg-surface-container/40 transition-colors"
            >
              <td className="px-3 py-2 text-on-surface-variant tabular-nums">{i + 1}</td>
              <td className="px-3 py-2 font-bold text-on-surface">{r.route_number}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${sort === "crash_count" ? "font-bold text-on-surface" : "text-on-surface-variant"}`}>{fmt(r.crash_count)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${sort === "fatality_rate" ? "font-bold text-on-surface" : "text-on-surface-variant"}`}>{fmtRate(r.fatality_rate)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${sort === "crashes_per_mile" ? "font-bold text-on-surface" : "text-on-surface-variant"}`}>{fmtPerMile(r.crashes_per_mile)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-on-surface-variant">{r.miles ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

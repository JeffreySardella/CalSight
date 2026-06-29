import type { ReactNode } from "react";
import type { HighwayRow } from "../../hooks/useHighwayRankings";
import type { DataContext, FilterSnapshot } from "../../lib/ai/dataContext";
import { highwayStatContext } from "../../lib/ai/contextBuilders";
import { Explainable } from "../ai/Explainable";

interface HighwaySidePanelContentProps {
  row: HighwayRow;
  /** Active filter snapshot, threaded into the AI deep-dive context. */
  filters: FilterSnapshot;
}

function Stat({ label, value, context }: { label: string; value: string; context?: DataContext }) {
  const valueNode: ReactNode = context ? (
    <Explainable context={context} className="text-sm font-semibold text-on-surface tabular-nums">
      {value}
    </Explainable>
  ) : (
    <span className="text-sm font-semibold text-on-surface tabular-nums">{value}</span>
  );
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-sm text-on-surface-variant">{label}</span>
      {valueNode}
    </div>
  );
}

/**
 * Presentational summary of a single highway's crash danger, shown in the
 * side panel when a highway line is clicked on the map. Each stat is an
 * Explainable affordance — clicking opens the AI companion scoped to that
 * route + metric, so users can "go deeper" on a specific highway.
 */
export default function HighwaySidePanelContent({ row, filters }: HighwaySidePanelContentProps) {
  const route = row.route_number;
  const fatalityPct = `${(row.fatality_rate * 100).toFixed(1)}%`;
  const perMile = row.crashes_per_mile != null ? row.crashes_per_mile.toFixed(2) : "—";
  const miles = row.miles != null ? row.miles.toLocaleString() : "—";

  const ctx = (label: string, measure: string, value: number): DataContext =>
    highwayStatContext({ route, label: `${route} · ${label}`, measure, value, filters });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <span className="font-headline text-2xl font-bold tracking-tight text-on-surface">
          {route}
        </span>
        <p className="text-[10px] uppercase tracking-widest text-on-surface-variant font-medium">
          {miles} miles
        </p>
      </div>

      <div className="space-y-3">
        <Stat label="Crashes" value={row.crash_count.toLocaleString()} context={ctx("crashes", "crash_count", row.crash_count)} />
        <Stat label="Killed" value={row.total_killed.toLocaleString()} context={ctx("fatalities", "fatalities", row.total_killed)} />
        <Stat label="Injured" value={row.total_injured.toLocaleString()} context={ctx("injuries", "injuries", row.total_injured)} />
        <Stat label="Fatality rate" value={fatalityPct} context={ctx("fatality rate", "fatality_rate", row.fatality_rate)} />
        <Stat
          label="Crashes per mile"
          value={perMile}
          context={row.crashes_per_mile != null ? ctx("crashes per mile", "crashes_per_mile", row.crashes_per_mile) : undefined}
        />
      </div>
    </div>
  );
}

import type { HighwayRow } from "../../hooks/useHighwayRankings";

interface HighwaySidePanelContentProps {
  row: HighwayRow;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-sm text-on-surface-variant">{label}</span>
      <span className="text-sm font-semibold text-on-surface tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Presentational summary of a single highway's crash danger, shown in the
 * side panel when a highway line is clicked on the map. Formatting only — the
 * data is the HighwayRow already fetched by useHighwayRankings.
 */
export default function HighwaySidePanelContent({ row }: HighwaySidePanelContentProps) {
  const fatalityPct = `${(row.fatality_rate * 100).toFixed(1)}%`;
  const perMile = row.crashes_per_mile != null ? row.crashes_per_mile.toFixed(2) : "—";
  const miles = row.miles != null ? row.miles.toLocaleString() : "—";

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <span className="font-headline text-2xl font-bold tracking-tight text-on-surface">
          {row.route_number}
        </span>
        <p className="text-[10px] uppercase tracking-widest text-on-surface-variant font-medium">
          {miles} miles
        </p>
      </div>

      <div className="space-y-3">
        <Stat label="Crashes" value={row.crash_count.toLocaleString()} />
        <Stat label="Killed" value={row.total_killed.toLocaleString()} />
        <Stat label="Injured" value={row.total_injured.toLocaleString()} />
        <Stat label="Fatality rate" value={fatalityPct} />
        <Stat label="Crashes per mile" value={perMile} />
      </div>
    </div>
  );
}

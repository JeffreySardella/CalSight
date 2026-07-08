import type { ClusterPoint } from "../../hooks/useClusterHotspots";

interface ClusterSidePanelContentProps {
  cluster: ClusterPoint;
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
 * Presentational summary of a single crash hotspot, shown in the side panel
 * when a cluster marker is clicked on the map.
 */
export default function ClusterSidePanelContent({ cluster }: ClusterSidePanelContentProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <span className="font-headline text-2xl font-bold tracking-tight text-on-surface">
          Crash Hotspot
        </span>
        <p className="text-[10px] uppercase tracking-widest text-on-surface-variant font-medium">
          {cluster.lat.toFixed(2)}, {cluster.lng.toFixed(2)}
        </p>
      </div>

      <div className="space-y-3">
        <Stat label="Crashes" value={cluster.crash_count.toLocaleString()} />
        <Stat label="Z-score" value={cluster.z_score.toFixed(2)} />
        <Stat label="Fatal" value={cluster.severity.fatal.toLocaleString()} />
        <Stat label="Injury" value={cluster.severity.injury.toLocaleString()} />
        <Stat label="Property damage only" value={cluster.severity.pdo.toLocaleString()} />
      </div>
    </div>
  );
}

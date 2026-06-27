import { useApiHealth } from "../hooks/useApiHealth";

/**
 * Slim, non-blocking top bar shown while a materialized view is being
 * repopulated (e.g. mid-deploy). The site stays usable; the bar auto-clears
 * when /api/health returns to "ok". Distinct from MaintenanceGate, which is a
 * full-screen overlay for "maintenance"/"down".
 */
export default function RebuildingBanner() {
  const health = useApiHealth();
  if (health !== "rebuilding") return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-[900] flex items-center justify-center gap-2 bg-primary text-on-primary text-xs px-4 py-1.5 text-center"
    >
      <span className="material-symbols-outlined text-[16px] animate-spin" aria-hidden="true">
        sync
      </span>
      <span>Some data is being rebuilt and may be temporarily incomplete.</span>
    </div>
  );
}

import { useQueryClient } from "@tanstack/react-query";
import { useApiHealth } from "../hooks/useApiHealth";

/**
 * Full-screen overlay shown when the API is offline. The frontend is served
 * statically from Cloudflare Pages, so it stays up even while the API/box is
 * down for a migration — this turns raw fetch errors into a friendly screen.
 */
function MaintenanceScreen({ variant }: { variant: "maintenance" | "down" }) {
  const queryClient = useQueryClient();
  const isMaintenance = variant === "maintenance";

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-0 z-[1000] flex flex-col items-center justify-center bg-surface text-center p-8"
    >
      <span
        className="material-symbols-outlined text-[56px] text-primary mb-4"
        aria-hidden="true"
      >
        {isMaintenance ? "construction" : "cloud_off"}
      </span>
      <h1 className="text-on-surface font-semibold text-xl mb-2">
        {isMaintenance ? "Down for scheduled maintenance" : "Can’t reach CalSight"}
      </h1>
      <p className="text-on-surface-variant text-sm max-w-sm mb-6">
        {isMaintenance
          ? "CalSight is being updated and will be back shortly. Thanks for your patience."
          : "We’re having trouble connecting to the server. This may be temporary — we’ll keep trying automatically."}
      </p>
      <div className="flex items-center gap-3">
        <span
          className="inline-block w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"
          aria-hidden="true"
        />
        <span className="text-on-surface-variant text-xs">Checking again automatically…</span>
      </div>
      <button
        type="button"
        onClick={() => queryClient.invalidateQueries({ queryKey: ["health"] })}
        className="mt-6 px-6 py-2 bg-primary text-on-primary rounded-full text-sm font-semibold hover:opacity-90 transition-opacity"
      >
        Retry now
      </button>
    </div>
  );
}

/**
 * Watches API health and renders the maintenance overlay when needed.
 * Renders nothing in the normal "ok" state.
 */
export default function MaintenanceGate() {
  const health = useApiHealth();
  if (health !== "maintenance" && health !== "down") return null;
  return <MaintenanceScreen variant={health} />;
}

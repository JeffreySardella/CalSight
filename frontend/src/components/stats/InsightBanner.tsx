import type { HeroMetrics } from "../../hooks/useStats";

interface InsightBannerProps {
  heroMetrics: HeroMetrics;
  loading: boolean;
}

export default function InsightBanner({ heroMetrics, loading }: InsightBannerProps) {
  if (loading) return null;

  const { incidentYoYPct, yoyFatalityChangePct } = heroMetrics;

  if (incidentYoYPct == null && yoyFatalityChangePct == null) return null;

  const parts: string[] = [];

  if (incidentYoYPct != null) {
    const direction = incidentYoYPct >= 0 ? "up" : "down";
    parts.push(`Crashes are ${direction} ${Math.abs(incidentYoYPct)}% YoY`);
  }

  if (yoyFatalityChangePct != null) {
    const direction = yoyFatalityChangePct >= 0 ? "up" : "down";
    parts.push(`fatalities are ${direction} ${Math.abs(yoyFatalityChangePct)}%`);
  }

  const sentence = parts.join(" — ");

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 bg-surface-container-low border-l-2 border-primary rounded-lg px-4 py-3"
    >
      <span className="material-symbols-outlined text-primary text-[20px]" aria-hidden="true">
        auto_awesome
      </span>
      <p className="text-on-surface text-sm font-medium">{sentence}</p>
    </div>
  );
}

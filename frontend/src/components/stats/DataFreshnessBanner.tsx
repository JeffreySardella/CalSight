import { useDataFreshness, useInvalidateAllDashboard } from "../../hooks/useDataFreshness";

export default function DataFreshnessBanner() {
  const { relativeTime, isStale, isLoading } = useDataFreshness();
  const invalidate = useInvalidateAllDashboard();

  if (isLoading || !relativeTime) return null;

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
        isStale
          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
          : "bg-surface-container-high text-on-surface-variant"
      }`}
    >
      <span className="material-symbols-outlined text-[16px] flex-shrink-0" aria-hidden="true">
        {isStale ? "warning" : "schedule"}
      </span>
      <span className="hidden sm:inline">Last updated: {relativeTime}</span>
      <span className="sm:hidden">{relativeTime}</span>
      <button
        type="button"
        onClick={invalidate}
        className="ml-1 hover:text-primary transition-colors flex-shrink-0"
        aria-label="Refresh dashboard data"
        title="Refresh data"
      >
        <span className="material-symbols-outlined text-[16px]">refresh</span>
      </button>
    </div>
  );
}

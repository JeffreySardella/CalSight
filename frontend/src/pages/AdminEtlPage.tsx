import { useEtlStatus, useEtlRuns, useTriggerEtl } from "../hooks/useEtlStatus";
import type { EtlSource } from "../hooks/useEtlStatus";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function statusColor(status: string): string {
  switch (status) {
    case "success": return "bg-green-500";
    case "error": return "bg-red-500";
    case "running": return "bg-amber-500 animate-pulse";
    case "skipped": return "bg-gray-400";
    default: return "bg-gray-400";
  }
}

function scheduleBadge(schedule: string): string {
  switch (schedule) {
    case "daily": return "text-blue-600 bg-blue-100 dark:text-blue-300 dark:bg-blue-900/40";
    case "weekly": return "text-purple-600 bg-purple-100 dark:text-purple-300 dark:bg-purple-900/40";
    case "monthly": return "text-teal-600 bg-teal-100 dark:text-teal-300 dark:bg-teal-900/40";
    case "static": return "text-gray-500 bg-gray-100 dark:text-gray-400 dark:bg-gray-800";
    default: return "text-gray-500 bg-gray-100 dark:text-gray-400 dark:bg-gray-800";
  }
}

function SourceCard({ source }: { source: EtlSource }) {
  const run = source.last_run;
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-label text-sm font-semibold text-on-surface truncate">
          {source.name}
        </h3>
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${scheduleBadge(source.schedule)}`}>
          {source.schedule}
        </span>
      </div>

      {run ? (
        <>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${statusColor(run.status)}`} />
            <span className="text-xs text-on-surface-variant capitalize">{run.status}</span>
            <span className="text-xs text-on-surface-variant ml-auto">{timeAgo(run.started_at)}</span>
          </div>
          {run.rows_loaded != null && (
            <p className="text-xs text-on-surface-variant">
              {run.rows_loaded.toLocaleString()} rows loaded
            </p>
          )}
          {run.error_message && (
            <p className="text-xs text-red-500 line-clamp-2">{run.error_message}</p>
          )}
        </>
      ) : (
        <p className="text-xs text-on-surface-variant italic">Never run</p>
      )}

      {source.depends_on.length > 0 && (
        <p className="text-[10px] text-on-surface-variant">
          after: {source.depends_on.join(", ")}
        </p>
      )}
    </div>
  );
}

export default function AdminEtlPage() {
  const { data: sources, isLoading: sourcesLoading, error: sourcesError } = useEtlStatus();
  const { data: runs, isLoading: runsLoading } = useEtlRuns(20);
  const trigger = useTriggerEtl();

  return (
    <main className="max-w-6xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="font-headline text-3xl font-bold text-on-surface">ETL Dashboard</h1>
          <p className="text-sm text-on-surface-variant mt-1">Data pipeline status and management</p>
        </div>
        <button
          onClick={() => trigger.mutate(undefined)}
          disabled={trigger.isPending}
          className="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {trigger.isPending ? "Starting..." : "Run All"}
        </button>
      </div>

      {trigger.isSuccess && (
        <div className="mb-6 p-3 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 text-sm">
          Pipeline triggered successfully. Refresh to see progress.
        </div>
      )}

      {sourcesError && (
        <div className="mb-6 p-3 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 text-sm">
          Failed to load ETL status: {(sourcesError as Error).message}
        </div>
      )}

      <section className="mb-12">
        <h2 className="font-headline text-xl font-semibold text-on-surface mb-4">Data Sources</h2>
        {sourcesLoading ? (
          <p className="text-sm text-on-surface-variant">Loading...</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {sources?.map((s) => <SourceCard key={s.name} source={s} />)}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-headline text-xl font-semibold text-on-surface mb-4">Recent Runs</h2>
        {runsLoading ? (
          <p className="text-sm text-on-surface-variant">Loading...</p>
        ) : runs && runs.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-outline-variant">
            <table className="w-full text-sm">
              <thead className="bg-surface-container">
                <tr className="text-left text-on-surface-variant text-xs uppercase tracking-wider">
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3">Rows</th>
                  <th className="px-4 py-3">Triggered By</th>
                  <th className="px-4 py-3">Validation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {runs.map((r) => (
                  <tr key={r.id} className="text-on-surface">
                    <td className="px-4 py-3 font-medium">{r.source}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${statusColor(r.status)}`} />
                        <span className="capitalize">{r.status}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">{timeAgo(r.started_at)}</td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {r.rows_loaded?.toLocaleString() ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant capitalize">{r.triggered_by ?? "—"}</td>
                    <td className="px-4 py-3 text-on-surface-variant capitalize">{r.validation_status ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-on-surface-variant italic">No runs recorded yet.</p>
        )}
      </section>
    </main>
  );
}

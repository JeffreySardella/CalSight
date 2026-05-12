import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";

import { useFilterParams, buildFilterQS } from "../../hooks/useFilterParams";
import { computeFilterScope } from "../../lib/export/filterSummary";
import {
  CsvExportEmptyError,
  CsvExportTooLargeError,
  exportCsv,
} from "../../lib/export/csv";
import { exportPdf } from "../../lib/export/pdf";
import { exportPng, PngExportError } from "../../lib/export/png";
import {
  type FormatKey,
  failExport,
  finishExport,
  resetExport,
  setActiveFormat,
  startExport,
  updateProgress,
  useExportState,
} from "./exportStore";

interface FormatOption {
  key: FormatKey;
  icon: string;
  label: string;
  description: string;
}

const FORMATS: FormatOption[] = [
  { key: "csv", icon: "table_chart", label: "CSV", description: "Raw crash rows matching filters (up to 50K)" },
  { key: "pdf", icon: "picture_as_pdf", label: "PDF", description: "One-page summary report" },
  { key: "png", icon: "image", label: "PNG", description: "Current map view as image" },
];

export default function DataExportPanel() {
  const filters = useFilterParams();
  const [searchParams] = useSearchParams();
  const { activeFormat, phase } = useExportState();

  // Tracks the active fetch loop. Aborted on unmount, but NOT on every
  // dep change — the previous version did that and self-cancelled the
  // export the moment startExport() flipped isRunning to true.
  const abortRef = useRef<AbortController | null>(null);

  const filterState = useMemo(() => ({
    dateRange: filters.selectedDateRange,
    severities: filters.selectedSeverities,
    counties: filters.selectedCounties,
    causes: filters.selectedCauses,
    alcohol: filters.selectedAlcohol,
    distracted: filters.selectedDistracted,
    pedestrian: filters.selectedPedestrian,
    cyclist: filters.selectedCyclist,
    drug: filters.selectedDrug,
    driverAge: filters.selectedDriverAge,
    hitRun: filters.selectedHitRun,
    weather: filters.selectedWeather,
    lighting: filters.selectedLighting,
    collisionType: filters.selectedCollisionType,
    roadType: filters.selectedRoadType,
  }), [filters]);

  const scope = useMemo(() => computeFilterScope(filterState), [filterState]);
  const filterQs = useMemo(() => buildFilterQS(searchParams), [searchParams]);

  // CSV requires at least one filter (matches /api/crashes?include_total=true).
  const csvBlocked = activeFormat === "csv" && !scope.hasAnyFilter;
  const isRunning = phase.kind === "running";

  // Snapshot the latest values on a ref so the event handler always reads
  // fresh state. We want the `export:trigger` listener to be attached
  // exactly once for the panel's lifetime — re-attaching on every render
  // would race with the click event and (worse) the cleanup would abort
  // any in-flight export.
  const latestRef = useRef({ activeFormat, csvBlocked, filterQs, scope, isRunning });
  latestRef.current = { activeFormat, csvBlocked, filterQs, scope, isRunning };

  useEffect(() => {
    async function handleTrigger() {
      const { activeFormat: fmt, csvBlocked: blocked, filterQs: qs, scope: s, isRunning: running } = latestRef.current;
      if (running) return; // re-entrancy guard

      try {
        if (fmt === "csv") {
          if (blocked) {
            failExport("csv", "Apply at least one filter to export a CSV.");
            return;
          }
          abortRef.current?.abort();
          abortRef.current = new AbortController();
          startExport("csv", "Counting rows…");
          await exportCsv({
            filterQs: qs,
            filenameSuffix: s.filenameSuffix,
            signal: abortRef.current.signal,
            onProgress: (p) => {
              if (p.phase === "counting") {
                updateProgress("csv", "Counting rows…");
              } else if (p.phase === "fetching") {
                const pct = p.total > 0 ? Math.round((p.fetched / p.total) * 100) : 0;
                updateProgress(
                  "csv",
                  `${p.fetched.toLocaleString()} of ${p.total.toLocaleString()} crashes`,
                  pct,
                );
              } else if (p.phase === "building") {
                updateProgress("csv", "Building file…", 100);
              }
            },
          });
          finishExport("csv");
        } else if (fmt === "pdf") {
          abortRef.current?.abort();
          abortRef.current = new AbortController();
          startExport("pdf", "Generating report…");
          await exportPdf({
            scope: s,
            filterQs: qs,
            signal: abortRef.current.signal,
          });
          finishExport("pdf");
        } else {
          startExport("png", "Capturing map…");
          await exportPng({ filenameSuffix: s.filenameSuffix });
          finishExport("png");
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          resetExport();
          return;
        }
        const message =
          err instanceof CsvExportTooLargeError ? err.message :
          err instanceof CsvExportEmptyError ? err.message :
          err instanceof PngExportError ? err.message :
          err instanceof Error ? `Export failed: ${err.message}` :
          "Export failed.";
        failExport(fmt, message);
      }
    }

    window.addEventListener("export:trigger", handleTrigger);
    return () => {
      window.removeEventListener("export:trigger", handleTrigger);
      // Abort only on real unmount (panel close, page change). React 18
      // StrictMode also runs cleanup once on mount — that's fine because
      // there's no in-flight export at that moment.
      abortRef.current?.abort();
    };
  }, []);

  return (
    <div className="space-y-8 pb-32">
      {/* Format Selection */}
      <div className="space-y-4">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
          Format
        </h3>
        <div className="flex flex-col gap-3">
          {FORMATS.map(({ key, icon, label, description }) => {
            const isActive = activeFormat === key;
            return (
              <button
                key={key}
                onClick={() => {
                  setActiveFormat(key);
                  if (phase.kind === "error" || phase.kind === "success") resetExport();
                }}
                disabled={isRunning}
                className={`flex items-center gap-4 p-4 rounded-lg text-left transition-colors ${
                  isActive
                    ? "bg-primary-container text-on-primary-container"
                    : "bg-surface-container-high hover:bg-surface-container-highest group"
                } ${isRunning ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <span
                  className={`material-symbols-outlined text-2xl ${
                    isActive ? "" : "text-on-surface-variant group-hover:text-on-surface"
                  }`}
                >
                  {icon}
                </span>
                <div className="flex flex-col">
                  <span
                    className={`font-semibold text-xs font-body ${isActive ? "" : "text-on-surface"}`}
                  >
                    {label}
                  </span>
                  <span
                    className={`text-[10px] font-body ${isActive ? "opacity-80" : "text-on-surface-variant"}`}
                  >
                    {description}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Export Scope */}
      <div className="space-y-4">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
          Scope
        </h3>
        <div className="bg-surface-container rounded-lg p-4 space-y-3">
          <p className="text-[11px] font-medium text-on-surface font-body leading-tight">
            {scope.hasAnyFilter
              ? "Exporting data matching your current filters"
              : "No filters applied — full dataset"}
          </p>
          <p className="text-[10px] italic text-on-surface-variant leading-tight">
            {scope.oneLine}
          </p>
          <div className="flex flex-col gap-1.5 pt-1">
            {scope.rows.map(({ label, value }) => (
              <div
                key={label}
                className="flex justify-between items-center text-[10px] text-on-surface-variant font-body gap-3"
              >
                <span className="flex-shrink-0">{label}</span>
                <span className="font-semibold text-right truncate">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Status / progress / error */}
      {phase.kind !== "idle" && (
        <div className="space-y-2">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
            Status
          </h3>
          {phase.kind === "running" && (
            <div className="bg-surface-container rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 text-[11px] text-on-surface font-medium">
                <span className="inline-block w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span>{phase.message}</span>
              </div>
              {phase.progress != null && (
                <div className="h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${phase.progress}%` }}
                  />
                </div>
              )}
            </div>
          )}
          {phase.kind === "error" && (
            <div role="alert" className="bg-error-container text-on-error-container rounded-lg p-4 text-[11px] leading-snug">
              {phase.message}
            </div>
          )}
          {phase.kind === "success" && (
            <div className="bg-tertiary-container text-on-tertiary-container rounded-lg p-4 text-[11px] flex items-center gap-2">
              <span className="material-symbols-outlined text-xl shrink-0">check_circle</span>
              <span>{phase.format.toUpperCase()} downloaded.</span>
            </div>
          )}
        </div>
      )}

      {/* CSV pre-flight hint — only shown when active format is CSV and
          no filters set, before the user clicks Export. */}
      {csvBlocked && phase.kind === "idle" && (
        <div className="bg-surface-container rounded-lg p-4 text-[11px] text-on-surface-variant leading-snug">
          <span className="material-symbols-outlined text-base align-middle mr-1">info</span>
          CSV export requires at least one filter (county, year, severity, etc.) so the file stays a sensible size.
        </div>
      )}
    </div>
  );
}

export function DataExportPanelFooter() {
  const { activeFormat, phase } = useExportState();
  const isRunning = phase.kind === "running";
  const label = isRunning
    ? phase.progress != null
      ? `Exporting… ${phase.progress}%`
      : "Exporting…"
    : `Export ${activeFormat.toUpperCase()}`;

  return (
    <button
      onClick={() => {
        if (!isRunning) window.dispatchEvent(new CustomEvent("export:trigger"));
      }}
      disabled={isRunning}
      className={`w-full bg-primary text-on-primary py-4 rounded-md text-[11px] font-bold tracking-[0.2em] uppercase shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2 ${
        isRunning ? "opacity-60 cursor-not-allowed" : "hover:opacity-90"
      }`}
    >
      {isRunning ? (
        <span className="inline-block w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin" />
      ) : (
        <span className="material-symbols-outlined text-lg">file_download</span>
      )}
      {label}
    </button>
  );
}

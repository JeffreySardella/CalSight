import { useState, useEffect, useCallback } from "react";

type FormatKey = "csv" | "pdf" | "png";

interface FormatOption {
  key: FormatKey;
  icon: string;
  label: string;
  description: string;
}

const FORMATS: FormatOption[] = [
  {
    key: "csv",
    icon: "table_chart",
    label: "CSV",
    description: "Raw data with all fields",
  },
  {
    key: "pdf",
    icon: "picture_as_pdf",
    label: "PDF",
    description: "Formatted report with charts",
  },
  {
    key: "png",
    icon: "image",
    label: "PNG",
    description: "Current map view as image",
  },
];

const SCOPE_ITEMS = [
  { label: "County", value: "Los Angeles" },
  { label: "Years", value: "2022-2024" },
  { label: "Severity", value: "All" },
] as const;

export default function DataExportPanel() {
  const [activeFormat, setActiveFormat] = useState<FormatKey>("csv");

  const handleExport = useCallback(() => {
    console.log(`Exporting ${activeFormat.toUpperCase()}...`);
  }, [activeFormat]);

  useEffect(() => {
    window.addEventListener("export:trigger", handleExport);
    return () => window.removeEventListener("export:trigger", handleExport);
  }, [handleExport]);

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
                onClick={() => setActiveFormat(key)}
                className={`flex items-center gap-4 p-4 rounded-lg text-left transition-colors ${
                  isActive
                    ? "bg-primary-container text-on-primary-container"
                    : "bg-surface-container-high hover:bg-surface-container-highest group"
                }`}
              >
                <span
                  className={`material-symbols-outlined text-2xl ${
                    isActive
                      ? ""
                      : "text-on-surface-variant group-hover:text-on-surface"
                  }`}
                >
                  {icon}
                </span>
                <div className="flex flex-col">
                  <span
                    className={`font-semibold text-xs font-body ${
                      isActive ? "" : "text-on-surface"
                    }`}
                  >
                    {label}
                  </span>
                  <span
                    className={`text-[10px] font-body ${
                      isActive ? "opacity-80" : "text-on-surface-variant"
                    }`}
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
            Exporting data matching your current filters
          </p>
          <div className="flex flex-col gap-1.5">
            {SCOPE_ITEMS.map(({ label, value }) => (
              <div
                key={label}
                className="flex justify-between items-center text-[10px] text-on-surface-variant font-body"
              >
                <span>{label}</span>
                <span className="font-semibold">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DataExportPanelFooter() {
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent("export:trigger"))}
      className="w-full bg-primary text-on-primary py-4 rounded-md text-[11px] font-bold tracking-[0.2em] uppercase hover:opacity-90 shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2"
    >
      <span className="material-symbols-outlined text-lg">file_download</span>
      Export
    </button>
  );
}

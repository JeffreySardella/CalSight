import { useState, useEffect } from "react";

const YEARS = [2020, 2021, 2022, 2023, 2024, 2025] as const;
const SEVERITIES = ["Fatal", "Severe Injury", "Minor Injury", "Property Damage Only"] as const;

const INITIAL_YEARS = new Set([2020, 2023]);
const INITIAL_SEVERITIES = new Set(["Fatal"]);

export default function FiltersPanel() {
  const [selectedYears, setSelectedYears] = useState<Set<number>>(
    () => new Set(INITIAL_YEARS),
  );
  const [selectedSeverities, setSelectedSeverities] = useState<Set<string>>(
    () => new Set(INITIAL_SEVERITIES),
  );

  useEffect(() => {
    function handleClear() {
      setSelectedYears(new Set(INITIAL_YEARS));
      setSelectedSeverities(new Set(INITIAL_SEVERITIES));
    }
    window.addEventListener("filters:clear-all", handleClear);
    return () => window.removeEventListener("filters:clear-all", handleClear);
  }, []);

  function toggleYear(year: number) {
    setSelectedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) {
        next.delete(year);
      } else {
        next.add(year);
      }
      return next;
    });
  }

  function toggleSeverity(severity: string) {
    setSelectedSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(severity)) {
        next.delete(severity);
      } else {
        next.add(severity);
      }
      return next;
    });
  }

  return (
    <div className="space-y-8 pb-32">
      {/* County Selector */}
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          County
        </label>
        <div className="relative">
          <select className="w-full bg-surface-container-high border-none focus:border-primary focus:ring-0 text-sm py-3 px-4 rounded-t-sm appearance-none cursor-pointer">
            <option value="">Select County...</option>
            <option value="alameda">Alameda</option>
            <option value="fresno">Fresno</option>
            <option value="los-angeles">Los Angeles</option>
            <option value="sacramento">Sacramento</option>
            <option value="san-diego">San Diego</option>
            <option value="san-francisco">San Francisco</option>
          </select>
          <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-on-surface-variant text-lg">
            expand_more
          </span>
        </div>
      </div>

      {/* Year Range */}
      <div className="space-y-3">
        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          Year
        </label>
        <div className="flex flex-wrap gap-2">
          {YEARS.map((year) => (
            <button
              key={year}
              onClick={() => toggleYear(year)}
              className={
                selectedYears.has(year)
                  ? "px-3 py-1.5 rounded-full text-xs font-semibold bg-primary text-on-primary transition-all"
                  : "px-3 py-1.5 rounded-full text-xs font-semibold bg-surface-container-high text-on-surface-variant hover:bg-surface-variant transition-all"
              }
            >
              {year}
            </button>
          ))}
        </div>
      </div>

      {/* Cause Type */}
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          Cause Type
        </label>
        <div className="relative">
          <select className="w-full bg-surface-container-high border-none focus:border-primary focus:ring-0 text-sm py-3 px-4 rounded-t-sm appearance-none cursor-pointer">
            <option value="">All Causes</option>
            <option value="dui">DUI</option>
            <option value="speeding">Speeding</option>
            <option value="distracted">Distracted Driving</option>
            <option value="weather">Weather-Related</option>
            <option value="lane-change">Unsafe Lane Change</option>
            <option value="other">Other</option>
          </select>
          <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-on-surface-variant text-lg">
            expand_more
          </span>
        </div>
      </div>

      {/* Severity */}
      <div className="space-y-3">
        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          Severity
        </label>
        <div className="flex flex-wrap gap-2">
          {SEVERITIES.map((severity) => (
            <button
              key={severity}
              onClick={() => toggleSeverity(severity)}
              className={
                selectedSeverities.has(severity)
                  ? "px-3 py-1.5 rounded-full text-xs font-semibold bg-primary text-on-primary transition-all"
                  : "px-3 py-1.5 rounded-full text-xs font-semibold bg-surface-container-high text-on-surface-variant hover:bg-surface-variant transition-all"
              }
            >
              {severity}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function FiltersPanelFooter() {
  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={() => {
          console.log("Filters cleared");
          window.dispatchEvent(new CustomEvent("filters:clear-all"));
        }}
        className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant hover:text-on-surface transition-colors mx-auto underline-offset-4 hover:underline"
      >
        Clear All
      </button>
      <button
        onClick={() => console.log("Filters applied")}
        className="w-full bg-primary text-on-primary py-4 rounded-md text-[11px] font-bold tracking-[0.2em] uppercase hover:opacity-90 shadow-lg shadow-primary/20 transition-all"
      >
        Apply Filters
      </button>
    </div>
  );
}

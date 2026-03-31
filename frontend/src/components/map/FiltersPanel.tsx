import { useState, useEffect, useMemo, useRef } from "react";

const YEARS = [2020, 2021, 2022, 2023, 2024, 2025] as const;
const SEVERITIES = ["Fatal", "Severe Injury", "Minor Injury", "Property Damage Only"] as const;

const INITIAL_YEARS = new Set([2020, 2023]);
const INITIAL_SEVERITIES = new Set(["Fatal"]);

const COUNTIES = [
  "Alameda","Alpine","Amador","Butte","Calaveras","Colusa","Contra Costa",
  "Del Norte","El Dorado","Fresno","Glenn","Humboldt","Imperial","Inyo",
  "Kern","Kings","Lake","Lassen","Los Angeles","Madera","Marin","Mariposa",
  "Mendocino","Merced","Modoc","Mono","Monterey","Napa","Nevada","Orange",
  "Placer","Plumas","Riverside","Sacramento","San Benito","San Bernardino",
  "San Diego","San Francisco","San Joaquin","San Luis Obispo","San Mateo",
  "Santa Barbara","Santa Clara","Santa Cruz","Shasta","Sierra","Siskiyou",
  "Solano","Sonoma","Stanislaus","Sutter","Tehama","Trinity","Tulare",
  "Tuolumne","Ventura","Yolo","Yuba"
] as const;

export default function FiltersPanel() {
  const [selectedYears, setSelectedYears] = useState<Set<number>>(
    () => new Set(INITIAL_YEARS),
  );
  const [selectedSeverities, setSelectedSeverities] = useState<Set<string>>(
    () => new Set(INITIAL_SEVERITIES),
  );
  const [selectedCounty, setSelectedCounty] = useState("");
  const [countyQuery, setCountyQuery] = useState("");
  const [isCountyOpen, setIsCountyOpen] = useState(false);

  const countyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClear() {
      setSelectedYears(new Set(INITIAL_YEARS));
      setSelectedSeverities(new Set(INITIAL_SEVERITIES));
      setSelectedCounty("");
      setCountyQuery("");
      setIsCountyOpen(false);
    }
    window.addEventListener("filters:clear-all", handleClear);
    return () => window.removeEventListener("filters:clear-all", handleClear);
  }, []);
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        countyRef.current &&
        !countyRef.current.contains(event.target as Node)
      ) {
        setIsCountyOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredCounties = useMemo(() => {
    const query = countyQuery.trim().toLowerCase();
    if (!query) return COUNTIES;

    return COUNTIES.filter((county) =>
      county.toLowerCase().includes(query)
    );
  }, [countyQuery]);

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

  function selectCounty(county: string) {
    setSelectedCounty(county);
    setCountyQuery(county);
    setIsCountyOpen(false);
  }

  return (
    <div className="space-y-8 pb-32">

      {/* County */}
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          County
        </label>

        <div className="relative" ref={countyRef}>
          <input
            type="text"
            value={countyQuery}
            onChange={(e) => {
              setCountyQuery(e.target.value);
              setSelectedCounty("");
              setIsCountyOpen(true);
            }}
            onFocus={() => setIsCountyOpen(true)}
            placeholder="Search county..."
            className="w-full bg-surface-container-high border-none focus:border-primary focus:ring-0 text-sm py-3 px-4 pr-20 rounded-t-sm appearance-none"
          />

          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">

            {countyQuery && (
              <button
                type="button"
                onClick={() => {
                  setCountyQuery("");
                  setSelectedCounty("");
                  setIsCountyOpen(false);
                }}
                className="text-on-surface-variant hover:text-on-surface transition-colors translate-y-0.5"
              >
                <span className="material-symbols-outlined text-[18px]">
                  close
                </span>
              </button>
            )}

            <span className="material-symbols-outlined text-on-surface-variant text-[18px] pointer-events-none">
              expand_more
            </span>

          </div>

          {isCountyOpen && (
            <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md bg-surface-container-high shadow-lg">

              <button
                type="button"
                onClick={() => {
                  setSelectedCounty("");
                  setCountyQuery("");
                  setIsCountyOpen(false);
                }}
                className="w-full px-4 py-3 text-left text-sm hover:bg-surface-variant"
              >
                All Counties
              </button>

              {filteredCounties.map((county) => (
                <button
                  key={county}
                  type="button"
                  onClick={() => selectCounty(county)}
                  className={
                    selectedCounty === county
                      ? "w-full px-4 py-3 text-left text-sm bg-surface-variant"
                      : "w-full px-4 py-3 text-left text-sm hover:bg-surface-variant"
                  }
                >
                  {county}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Year Range */}
      <div className="space-y-3">
        <label className="text-[10px] font-bold uppercase tracking-widest">
          Year
        </label>
        <div className="flex flex-wrap gap-2">
          {YEARS.map((year) => (
            <button
              key={year}
              onClick={() => toggleYear(year)}
              className={
                selectedYears.has(year)
                  ? "px-3 py-1.5 rounded-full text-xs font-semibold bg-primary text-on-primary"
                  : "px-3 py-1.5 rounded-full text-xs font-semibold bg-surface-container-high"
              }
            >
              {year}
            </button>
          ))}
        </div>
      </div>

      {/* Cause Type */}
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest">
          Cause Type
        </label>
        <div className="relative">
          <select className="w-full bg-surface-container-high text-sm py-3 px-4 rounded-t-sm">
            <option value="">All Causes</option>
            <option value="dui">DUI</option>
            <option value="speeding">Speeding</option>
            <option value="distracted">Distracted Driving</option>
            <option value="weather">Weather</option>
            <option value="lane-change">Lane Change</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {/* Severity */}
      <div className="space-y-3">
        <label className="text-[10px] font-bold uppercase tracking-widest">
          Severity
        </label>
        <div className="flex flex-wrap gap-2">
          {SEVERITIES.map((severity) => (
            <button
              key={severity}
              onClick={() => toggleSeverity(severity)}
              className={
                selectedSeverities.has(severity)
                  ? "px-3 py-1.5 rounded-full text-xs font-semibold bg-primary text-on-primary"
                  : "px-3 py-1.5 rounded-full text-xs font-semibold bg-surface-container-high"
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
        className="text-[11px] font-bold uppercase tracking-widest"
      >
        Clear All
      </button>
      <button 
        onClick={() => console.log("Filters applied")}
        className="w-full bg-primary text-on-primary py-4 rounded-md text-[11px] font-bold uppercase"
      >
        Apply Filters
      </button>
    </div>
  );
}

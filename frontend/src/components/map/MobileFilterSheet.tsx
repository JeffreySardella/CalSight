import { useState, useEffect } from "react";

interface MobileFilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

const YEARS = [2020, 2021, 2022, 2023, 2024, 2025] as const;

const CAUSES = [
  { value: "dui", label: "DUI", icon: "local_bar" },
  { value: "speeding", label: "Speeding", icon: "speed" },
  { value: "distracted", label: "Distracted", icon: "phonelink_ring" },
  { value: "weather", label: "Weather", icon: "thunderstorm" },
  { value: "lane-change", label: "Lane Change", icon: "swap_horiz" },
  { value: "other", label: "Other", icon: "more_horiz" },
] as const;

const SEVERITIES = [
  { value: "low", label: "Low", icon: "shield" },
  { value: "moderate", label: "Moderate", icon: "warning" },
  { value: "critical", label: "Critical", icon: "emergency" },
] as const;

type PaletteKey = "default" | "warm" | "cool" | "colorblind";

const PALETTES: { key: PaletteKey; label: string; gradient: string }[] = [
  {
    key: "default",
    label: "Default",
    gradient: "bg-gradient-to-r from-slate-400 to-primary",
  },
  {
    key: "warm",
    label: "Warm",
    gradient: "bg-gradient-to-r from-amber-400 to-red-500",
  },
  {
    key: "cool",
    label: "Cool",
    gradient: "bg-gradient-to-r from-teal-400 to-green-500",
  },
  {
    key: "colorblind",
    label: "Colorblind Safe",
    gradient: "bg-gradient-to-r from-orange-400 via-white to-blue-500",
  },
];

export default function MobileFilterSheet({
  isOpen,
  onClose,
}: MobileFilterSheetProps) {
  const [selectedYears, setSelectedYears] = useState<Set<number>>(
    () => new Set([2023]),
  );
  const [selectedCauses, setSelectedCauses] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [selectedSeverities, setSelectedSeverities] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [countySearch, setCountySearch] = useState("");
  const [activePalette, setActivePalette] = useState<PaletteKey>("default");
  const [visible, setVisible] = useState(false);

  // Animate in/out
  useEffect(() => {
    if (isOpen) {
      // Small delay so the backdrop renders before the sheet slides up
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [isOpen]);

  function toggleYear(year: number) {
    setSelectedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }

  function toggleCause(cause: string) {
    setSelectedCauses((prev) => {
      const next = new Set(prev);
      if (next.has(cause)) next.delete(cause);
      else next.add(cause);
      return next;
    });
  }

  function toggleSeverity(severity: string) {
    setSelectedSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(severity)) next.delete(severity);
      else next.add(severity);
      return next;
    });
  }

  function handleReset() {
    setSelectedYears(new Set([2023]));
    setSelectedCauses(new Set());
    setSelectedSeverities(new Set());
    setCountySearch("");
    setActivePalette("default");
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] md:hidden">
      {/* Dimmed backdrop */}
      <div
        className={`absolute inset-0 bg-on-surface/20 backdrop-blur-sm transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      {/* Bottom sheet panel */}
      <div
        className={`absolute bottom-0 left-0 right-0 rounded-t-xl bg-surface-container-lowest max-h-[80vh] flex flex-col transition-transform duration-300 ease-out ${
          visible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-12 h-1.5 bg-outline-variant/30 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4">
          <h2 className="text-2xl font-bold text-on-surface font-headline">
            Filters
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-surface-container rounded-full text-on-surface-variant transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-8">
          {/* County search */}
          <div className="space-y-3">
            <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              County
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">
                search
              </span>
              <input
                type="text"
                value={countySearch}
                onChange={(e) => setCountySearch(e.target.value)}
                placeholder="Search California Counties..."
                className="w-full bg-surface-container-high border-none rounded-lg py-3.5 pl-12 pr-4 text-sm text-on-surface placeholder:text-outline focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          {/* Year chips */}
          <div className="space-y-3">
            <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Year
            </label>
            <div className="flex flex-wrap gap-2">
              {YEARS.map((year) => (
                <button
                  key={year}
                  onClick={() => toggleYear(year)}
                  className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    selectedYears.has(year)
                      ? "bg-primary text-on-primary"
                      : "bg-surface-container-high text-on-surface-variant"
                  }`}
                >
                  {year}
                </button>
              ))}
            </div>
          </div>

          {/* Cause expandable cards */}
          <div className="space-y-3">
            <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Cause
            </label>
            <div className="flex flex-wrap gap-2">
              {CAUSES.map((cause) => (
                <button
                  key={cause.value}
                  onClick={() => toggleCause(cause.value)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    selectedCauses.has(cause.value)
                      ? "bg-primary text-on-primary"
                      : "bg-surface-container-high text-on-surface-variant"
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {cause.icon}
                  </span>
                  {cause.label}
                </button>
              ))}
            </div>
          </div>

          {/* Severity 3-column grid */}
          <div className="space-y-3">
            <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Severity
            </label>
            <div className="grid grid-cols-3 gap-3">
              {SEVERITIES.map((severity) => (
                <button
                  key={severity.value}
                  onClick={() => toggleSeverity(severity.value)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-lg transition-all ${
                    selectedSeverities.has(severity.value)
                      ? "bg-primary text-on-primary"
                      : "bg-surface-container-high text-on-surface-variant"
                  }`}
                >
                  <span className="material-symbols-outlined text-[24px]">
                    {severity.icon}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-widest">
                    {severity.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Color Palette */}
          <div className="space-y-3">
            <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Color Palette
            </label>
            <div className="grid grid-cols-2 gap-3">
              {PALETTES.map(({ key, label, gradient }) => (
                <button
                  key={key}
                  onClick={() => setActivePalette(key)}
                  className={`p-2 rounded-lg text-left transition-all ${
                    activePalette === key
                      ? "bg-primary-container"
                      : "bg-surface-container-high"
                  }`}
                >
                  <div className={`h-10 w-full rounded-lg ${gradient} mb-1.5`} />
                  <span
                    className={`text-[10px] font-semibold block text-center ${
                      activePalette === key
                        ? "text-on-primary-container"
                        : "text-on-surface-variant"
                    }`}
                  >
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Sticky footer */}
        <div className="px-6 py-5 border-t border-outline-variant/15 flex items-center gap-4">
          <button
            onClick={handleReset}
            className="text-sm font-semibold text-on-surface-variant hover:text-on-surface transition-colors"
          >
            Reset
          </button>
          <button
            onClick={onClose}
            className="flex-1 bg-primary text-on-primary py-4 rounded-xl text-sm font-bold tracking-widest uppercase hover:opacity-90 transition-opacity"
          >
            Apply Filters
          </button>
        </div>
      </div>
    </div>
  );
}

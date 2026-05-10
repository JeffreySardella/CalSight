import type { StagedFilters } from "../../../hooks/useStagedFilters";

interface Preset {
  label: string;
  icon: string;
  description: string;
  filters: Partial<StagedFilters>;
}

const PRESETS: Preset[] = [
  {
    label: "Fatal DUI Crashes",
    icon: "local_bar",
    description: "DUI-caused crashes with fatalities",
    filters: { causes: new Set(["dui"]), severities: new Set(["Fatal"]) },
  },
  {
    label: "Pedestrian Safety",
    icon: "directions_walk",
    description: "All crashes involving pedestrians (2016+)",
    filters: { pedestrian: true },
  },
  {
    label: "Teen Drivers",
    icon: "speed",
    description: "At-fault drivers age 16-21 (2016+)",
    filters: { driverAge: "16-21" },
  },
  {
    label: "Senior Drivers",
    icon: "trending_up",
    description: "At-fault drivers age 65+ (2016+)",
    filters: { driverAge: "65+" },
  },
  {
    label: "Cyclist Crashes",
    icon: "pedal_bike",
    description: "All crashes involving cyclists (2016+)",
    filters: { cyclist: true },
  },
  {
    label: "Fatal Crashes Only",
    icon: "warning",
    description: "All fatal crashes across all years",
    filters: { severities: new Set(["Fatal"]) },
  },
];

function presetMatches(preset: Partial<StagedFilters>, staged: StagedFilters): boolean {
  const pCauses = preset.causes ?? new Set();
  const pSev = preset.severities ?? new Set();
  const pPed = preset.pedestrian ?? false;
  const pCyc = preset.cyclist ?? false;
  const pAge = preset.driverAge ?? null;
  const pAlc = preset.alcohol ?? false;

  if (staged.causes.size !== pCauses.size) return false;
  for (const c of pCauses) if (!staged.causes.has(c)) return false;
  if (staged.severities.size !== pSev.size) return false;
  for (const s of pSev) if (!staged.severities.has(s)) return false;
  if (staged.pedestrian !== pPed) return false;
  if (staged.cyclist !== pCyc) return false;
  if (staged.driverAge !== pAge) return false;
  if (staged.alcohol !== pAlc) return false;
  return true;
}

interface FilterPresetsProps {
  staged: StagedFilters;
  onApplyPreset: (filters: Partial<StagedFilters>) => void;
}

export default function FilterPresets({ staged, onApplyPreset }: FilterPresetsProps) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-bold text-on-surface mb-1">Quick Presets</h3>
        <p className="text-[11px] text-on-surface-variant leading-snug">
          Tap to load filters, then click Apply to see results.
        </p>
      </div>
      <div className="space-y-2">
        {PRESETS.map((preset) => {
          const isActive = presetMatches(preset.filters, staged);
          return (
            <button
              key={preset.label}
              onClick={() => onApplyPreset(preset.filters)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left ${
                isActive
                  ? "bg-primary-container ring-2 ring-primary/30"
                  : "bg-surface-container-high hover:bg-surface-variant"
              }`}
            >
              <span className={`material-symbols-outlined text-[20px] shrink-0 ${isActive ? "text-on-primary-container" : "text-primary"}`}>
                {preset.icon}
              </span>
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${isActive ? "text-on-primary-container" : "text-on-surface"}`}>{preset.label}</p>
                <p className={`text-[10px] ${isActive ? "text-on-primary-container/70" : "text-on-surface-variant"}`}>{preset.description}</p>
              </div>
              {isActive && (
                <span className="material-symbols-outlined text-[16px] text-primary ml-auto shrink-0">check</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
    filters: {
      causes: new Set(["dui"]),
      severities: new Set(["Fatal"]),
    },
  },
  {
    label: "Pedestrian Safety",
    icon: "directions_walk",
    description: "All crashes involving pedestrians (2016+)",
    filters: {
      pedestrian: true,
    },
  },
  {
    label: "Teen Drivers",
    icon: "speed",
    description: "At-fault drivers age 16-21 (2016+)",
    filters: {
      driverAge: "16-21",
    },
  },
  {
    label: "Senior Drivers",
    icon: "elderly",
    description: "At-fault drivers age 65+ (2016+)",
    filters: {
      driverAge: "65+",
    },
  },
  {
    label: "Cyclist Crashes",
    icon: "pedal_bike",
    description: "All crashes involving cyclists (2016+)",
    filters: {
      cyclist: true,
    },
  },
  {
    label: "Fatal Crashes Only",
    icon: "warning",
    description: "All fatal crashes across all years",
    filters: {
      severities: new Set(["Fatal"]),
    },
  },
];

interface FilterPresetsProps {
  onApplyPreset: (filters: Partial<StagedFilters>) => void;
}

export default function FilterPresets({ onApplyPreset }: FilterPresetsProps) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-bold text-on-surface mb-1">Quick Presets</h3>
        <p className="text-[11px] text-on-surface-variant leading-snug">
          One-tap filter combinations for common analyses.
        </p>
      </div>
      <div className="space-y-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => onApplyPreset(preset.filters)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-surface-container-high hover:bg-surface-variant transition-colors text-left"
          >
            <span className="material-symbols-outlined text-[20px] text-primary shrink-0">
              {preset.icon}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-on-surface">{preset.label}</p>
              <p className="text-[10px] text-on-surface-variant">{preset.description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

import { PRESETS, PRESET_KEYS } from "../../lib/dashboard/presets";
import type { PresetKey } from "../../lib/dashboard/types";

interface Props {
  active: PresetKey;
  onSelect: (key: PresetKey) => void;
}

export default function PresetPicker({ active, onSelect }: Props) {
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
      {PRESET_KEYS.map((key) => {
        const p = PRESETS[key];
        const isActive = key === active;
        return (
          <button
            key={key}
            onClick={() => onSelect(key)}
            aria-pressed={isActive}
            className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium whitespace-nowrap transition-colors min-h-[44px] ${
              isActive
                ? "bg-primary-container text-on-primary-container"
                : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{p.icon}</span>
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

import { PRESETS, PRESET_KEYS } from "../../lib/dashboard/presets";
import type { PresetKey } from "../../lib/dashboard/types";
import Sparkline from "../charts/Sparkline";

/**
 * Representative mini-data for each preset — gives a visual "fingerprint"
 * so users can see at a glance what shape of data each preset produces.
 * These are static representative patterns, not live data.
 */
const PRESET_SPARK_DATA: Record<PresetKey, number[]> = {
  overview: [12, 14, 13, 16, 15, 18, 17, 19, 16, 14],
  time: [3, 5, 8, 12, 10, 7, 9, 14, 11, 6],
  demographics: [8, 10, 15, 12, 9, 7, 6, 5, 4, 3],
  rates: [6, 7, 8, 9, 11, 10, 12, 14, 13, 15],
  dui: [10, 9, 11, 8, 7, 6, 5, 6, 4, 3],
  seasonal: [5, 8, 12, 15, 14, 16, 18, 17, 13, 10],
  equity: [4, 5, 7, 6, 8, 10, 9, 11, 12, 13],
  comparison: [14, 12, 10, 11, 9, 8, 10, 7, 6, 5],
};

interface Props {
  active: PresetKey;
  onSelect: (key: PresetKey) => void;
}

export default function PresetPicker({ active, onSelect }: Props) {
  const sorted = [active, ...PRESET_KEYS.filter((k) => k !== active)];
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar scroll-fade-r pb-1">
      {sorted.map((key) => {
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
            <Sparkline
              data={PRESET_SPARK_DATA[key]}
              width={40}
              height={16}
              showEndDot={false}
              showArea={false}
              strokeWidth={1.2}
              color={isActive ? "rgb(var(--on-primary-container))" : "rgb(var(--on-surface-variant))"}
              className="opacity-60"
              label={`${p.label} trend shape`}
            />
          </button>
        );
      })}
    </div>
  );
}

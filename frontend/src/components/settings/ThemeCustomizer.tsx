/**
 * ThemeCustomizer — settings panel for visual customization.
 *
 * Four working controls: preset themes, color palette (flows to charts + map),
 * card style, and density. All changes apply in real-time via CSS variable
 * injection through the CustomThemeContext.
 */

import { useRef } from "react";
import { useCustomTheme } from "../../context/CustomThemeContext";
import { PRESET_LABELS, PRESET_KEYS } from "../../lib/theme/presets";
import { CHART_PALETTES } from "../../lib/theme/palettes";
import type {
  PresetThemeKey,
  ChartPaletteKey,
  Density,
} from "../../lib/theme/types";

const CHIP_ACTIVE = "bg-primary-container text-on-primary-container";
const CHIP_INACTIVE = "text-on-surface-variant hover:text-on-surface";


const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
  { value: "spacious", label: "Spacious" },
];

const PALETTE_KEYS: ChartPaletteKey[] = [
  "default", "warm", "cool", "ocean", "forest", "sunset", "colorblind", "monochrome",
];

function PalettePreview({ paletteKey, isActive, onClick }: {
  paletteKey: ChartPaletteKey;
  isActive: boolean;
  onClick: () => void;
}) {
  const colors = paletteKey !== "custom"
    ? CHART_PALETTES[paletteKey].slice(0, 6)
    : [];

  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 p-1.5 rounded-lg transition-colors ${
        isActive ? "bg-primary-container" : "hover:bg-surface-container"
      }`}
      title={paletteKey}
    >
      <div className="flex gap-0.5">
        {colors.map((c, i) => (
          <div key={i} className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c }} />
        ))}
      </div>
      <span className={`text-[8px] font-bold uppercase tracking-wider ${
        isActive ? "text-on-primary-container" : "text-on-surface-variant"
      }`}>
        {paletteKey}
      </span>
    </button>
  );
}

export default function ThemeCustomizer() {
  const {
    customization,
    applyPreset,
    setChartPalette,
    setDensity,
    exportCurrentTheme,
    importThemeFile,
    reset,
    isModified,
  } = useCustomTheme();

  const importStatusRef = useRef<"idle" | "success" | "error">("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const success = await importThemeFile(file);
    importStatusRef.current = success ? "success" : "error";
    setTimeout(() => { importStatusRef.current = "idle"; }, 2000);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="space-y-5">
      {/* Preset themes */}
      <section>
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body block mb-2">
          Theme Presets
        </span>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESET_KEYS.map((key) => (
            <button
              key={key}
              onClick={() => applyPreset(key)}
              className={`text-left px-3 py-2 rounded-lg transition-colors ${
                customization.activePreset === key
                  ? "bg-primary-container text-on-primary-container"
                  : "hover:bg-surface-container text-on-surface"
              }`}
            >
              <span className="text-xs font-bold block">{PRESET_LABELS[key as PresetThemeKey].label}</span>
              <span className="text-[9px] text-on-surface-variant leading-tight">
                {PRESET_LABELS[key as PresetThemeKey].description}
              </span>
            </button>
          ))}
        </div>
        {isModified && (
          <p className="text-[9px] text-tertiary mt-1.5 font-medium">
            Custom modifications active
          </p>
        )}
      </section>

      <div className="border-t border-outline-variant/20" />

      {/* Color palette — applies to charts, map, and all data visualizations */}
      <section>
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body block mb-2">
          Color Palette
        </span>
        <p className="text-[9px] text-on-surface-variant mb-2">
          Changes chart colors, map overlays, and severity indicators across the entire app.
        </p>
        <div className="grid grid-cols-4 gap-1">
          {PALETTE_KEYS.map((key) => (
            <PalettePreview
              key={key}
              paletteKey={key}
              isActive={customization.chart.palette === key}
              onClick={() => setChartPalette(key)}
            />
          ))}
        </div>
      </section>

      <div className="border-t border-outline-variant/20" />

      {/* Density */}
      <section>
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body block mb-2">
          Density
        </span>
        <div className="flex gap-1 rounded-lg bg-surface-container p-1">
          {DENSITY_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setDensity(value)}
              className={`flex-1 flex items-center justify-center rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                customization.density === value ? CHIP_ACTIVE : CHIP_INACTIVE
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <div className="border-t border-outline-variant/20" />

      {/* Export / Import / Reset */}
      <section className="flex flex-wrap gap-2">
        <button
          onClick={() => exportCurrentTheme()}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-container text-on-surface text-[10px] font-bold hover:bg-surface-container-high transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">file_download</span>
          Export
        </button>
        <label className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-container text-on-surface text-[10px] font-bold hover:bg-surface-container-high transition-colors cursor-pointer">
          <span className="material-symbols-outlined text-[14px]">file_upload</span>
          Import
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            className="hidden"
          />
        </label>
        <button
          onClick={reset}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-error text-[10px] font-bold hover:bg-error-container/20 transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">restart_alt</span>
          Reset
        </button>
      </section>
    </div>
  );
}

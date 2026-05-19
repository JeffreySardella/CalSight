/**
 * ThemeCustomizer — settings panel for visual customization.
 *
 * Controls: preset themes, 3 semantic colors (mapped to severity/correlation/heatmap),
 * color palette (categorical chart colors + map), card style, and density.
 * All changes apply in real-time via CSS variable injection.
 */

import { useState, useRef } from "react";
import { useCustomTheme } from "../../context/CustomThemeContext";
import { PRESET_LABELS, PRESET_KEYS } from "../../lib/theme/presets";
import { CHART_PALETTES, PALETTE_SEVERITY } from "../../lib/theme/palettes";
import type {
  PresetThemeKey,
  ChartPaletteKey,
  CardStyle,
  TypeScale,
} from "../../lib/theme/types";

function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  return `${parseInt(h.slice(0, 2), 16)} ${parseInt(h.slice(2, 4), 16)} ${parseInt(h.slice(4, 6), 16)}`;
}

const CHIP_ACTIVE = "bg-primary-container text-on-primary-container";
const CHIP_INACTIVE = "text-on-surface-variant hover:text-on-surface";

const CARD_STYLES: { value: CardStyle; label: string; icon: string }[] = [
  { value: "elevated", label: "Elevated", icon: "layers" },
  { value: "minimal", label: "Minimal", icon: "crop_square" },
  { value: "bordered", label: "Bordered", icon: "border_all" },
  { value: "glass", label: "Glass", icon: "blur_on" },
];

const TYPE_SCALES: { value: TypeScale; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "default", label: "Default" },
  { value: "large", label: "Large" },
];

const PALETTE_KEYS: ChartPaletteKey[] = [
  "default", "warm", "cool", "ocean", "forest", "sunset", "colorblind", "monochrome",
];

function ColorInput({ label, description, value, onChange }: {
  label: string;
  description: string;
  value: string;
  onChange: (rgb: string) => void;
}) {
  const [r, g, b] = value.split(" ").map(Number);
  const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  function handleChange(hexValue: string) {
    const parsed = hexValue.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!parsed) return;
    const rgb = `${parseInt(parsed[1], 16)} ${parseInt(parsed[2], 16)} ${parseInt(parsed[3], 16)}`;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange(rgb), 80);
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={hex}
        onChange={(e) => handleChange(e.target.value)}
        className="w-7 h-7 rounded-md border border-outline-variant/30 cursor-pointer p-0"
        title={label}
      />
      <div>
        <span className="text-[10px] text-on-surface font-bold block">{label}</span>
        <span className="text-[8px] text-on-surface-variant">{description}</span>
      </div>
    </div>
  );
}

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
    setColors,
    setChartPalette,
    setCardStyle,
    setTypeScale,
    exportCurrentTheme,
    importThemeFile,
    reset,
    isModified,
  } = useCustomTheme();

  function handlePaletteChange(key: ChartPaletteKey) {
    setChartPalette(key);
    if (key !== "custom") {
      const sev = PALETTE_SEVERITY[key];
      setColors({
        error: hexToRgb(sev.fatal),
        tertiary: hexToRgb(sev.injury),
        primary: hexToRgb(sev.pdo),
      });
    }
  }

  const [importStatus, setImportStatus] = useState<"idle" | "success" | "error">("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const success = await importThemeFile(file);
    setImportStatus(success ? "success" : "error");
    setTimeout(() => setImportStatus("idle"), 2000);
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

      {/* 3 semantic colors — drive severity, correlation, and heatmap */}
      <section>
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body block mb-2">
          Severity Colors
        </span>
        <div className="space-y-2">
          <ColorInput label="Fatal" description="Fatal crashes, danger indicators" value={customization.colors.error} onChange={(v) => setColors({ error: v })} />
          <ColorInput label="Injury" description="Injury crashes, warnings" value={customization.colors.tertiary} onChange={(v) => setColors({ tertiary: v })} />
          <ColorInput label="PDO / General" description="Property damage, buttons, links" value={customization.colors.primary} onChange={(v) => setColors({ primary: v })} />
        </div>
      </section>

      <div className="border-t border-outline-variant/20" />

      {/* Chart palette */}
      <section>
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body block mb-2">
          Chart Palette
        </span>
        <div className="grid grid-cols-4 gap-1">
          {PALETTE_KEYS.map((key) => (
            <PalettePreview
              key={key}
              paletteKey={key}
              isActive={customization.chart.palette === key}
              onClick={() => handlePaletteChange(key)}
            />
          ))}
        </div>
      </section>

      <div className="border-t border-outline-variant/20" />

      {/* Card style */}
      <section>
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body block mb-2">
          Card Style
        </span>
        <div className="flex gap-1">
          {CARD_STYLES.map((style) => (
            <button
              key={style.value}
              onClick={() => setCardStyle(style.value)}
              className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${
                customization.cardStyle === style.value ? CHIP_ACTIVE : CHIP_INACTIVE
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">{style.icon}</span>
              <span className="text-[9px] font-medium">{style.label}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="border-t border-outline-variant/20" />

      {/* Text size */}
      <section>
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body block mb-2">
          Text Size
        </span>
        <div className="flex gap-1">
          {TYPE_SCALES.map((ts) => (
            <button
              key={ts.value}
              onClick={() => setTypeScale(ts.value)}
              className={`flex-1 flex items-center justify-center py-2 rounded-lg transition-colors text-[10px] font-bold ${
                customization.typeScale === ts.value ? CHIP_ACTIVE : CHIP_INACTIVE
              }`}
            >
              {ts.label}
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
        {importStatus === "success" && (
          <span className="text-[9px] text-primary font-bold self-center">Imported!</span>
        )}
        {importStatus === "error" && (
          <span className="text-[9px] text-error font-bold self-center">Invalid file</span>
        )}
      </section>
    </div>
  );
}

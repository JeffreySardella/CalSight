/**
 * ThemeCustomizer — full settings panel for theme customization.
 *
 * Renders preset selection, color pickers, card style previews, density
 * toggles, and typography scale controls. All changes apply in real-time
 * via CSS variable injection through the CustomThemeContext.
 */

import { useState, useRef } from "react";
import { useCustomTheme } from "../../context/CustomThemeContext";
import { PRESET_LABELS, PRESET_KEYS } from "../../lib/theme/presets";
import { CHART_PALETTES } from "../../lib/theme/palettes";
import type {
  PresetThemeKey,
  ChartPaletteKey,
  CardStyle,
  Density,
  TypeScale,
} from "../../lib/theme/types";

const CHIP_ACTIVE = "bg-primary-container text-on-primary-container";
const CHIP_INACTIVE = "text-on-surface-variant hover:text-on-surface";

const CARD_STYLES: { value: CardStyle; label: string; icon: string }[] = [
  { value: "elevated", label: "Elevated", icon: "layers" },
  { value: "minimal", label: "Minimal", icon: "crop_square" },
  { value: "bordered", label: "Bordered", icon: "border_all" },
  { value: "glass", label: "Glass", icon: "blur_on" },
];

const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
  { value: "spacious", label: "Spacious" },
];

const TYPE_SCALE_OPTIONS: { value: TypeScale; label: string }[] = [
  { value: "small", label: "S" },
  { value: "default", label: "M" },
  { value: "large", label: "L" },
];

const PALETTE_KEYS: ChartPaletteKey[] = [
  "default", "warm", "cool", "ocean", "forest", "sunset", "colorblind", "monochrome",
];

function ColorInput({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (rgb: string) => void;
}) {
  // Convert space-separated RGB to hex for the color picker
  const [r, g, b] = value.split(" ").map(Number);
  const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;

  function handleChange(hexValue: string) {
    const parsed = hexValue.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!parsed) return;
    const rgb = `${parseInt(parsed[1], 16)} ${parseInt(parsed[2], 16)} ${parseInt(parsed[3], 16)}`;
    onChange(rgb);
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
      <span className="text-[10px] text-on-surface-variant font-medium">{label}</span>
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

function CardStylePreview({ style, isActive, onClick }: {
  style: typeof CARD_STYLES[number];
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${
        isActive ? CHIP_ACTIVE : CHIP_INACTIVE
      }`}
    >
      <span className="material-symbols-outlined text-[18px]">{style.icon}</span>
      <span className="text-[9px] font-medium">{style.label}</span>
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
    setDensity,
    setTypeScale,
    exportCurrentTheme,
    importThemeFile,
    reset,
    isModified,
  } = useCustomTheme();

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [importStatus, setImportStatus] = useState<"idle" | "success" | "error">("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const success = await importThemeFile(file);
    setImportStatus(success ? "success" : "error");
    setTimeout(() => setImportStatus("idle"), 2000);
    // Reset file input
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

      {/* Color customization */}
      <section>
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body block mb-2">
          Colors
        </span>
        <div className="flex gap-4">
          <ColorInput label="Primary" value={customization.colors.primary} onChange={(v) => setColors({ primary: v })} />
          <ColorInput label="Tertiary" value={customization.colors.tertiary} onChange={(v) => setColors({ tertiary: v })} />
          <ColorInput label="Error" value={customization.colors.error} onChange={(v) => setColors({ error: v })} />
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
              onClick={() => setChartPalette(key)}
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
            <CardStylePreview
              key={style.value}
              style={style}
              isActive={customization.cardStyle === style.value}
              onClick={() => setCardStyle(style.value)}
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

      {/* Typography scale */}
      <section>
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body block mb-2">
          Text Size
        </span>
        <div className="flex gap-1 rounded-lg bg-surface-container p-1 w-fit">
          {TYPE_SCALE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setTypeScale(value)}
              className={`w-9 flex items-center justify-center rounded-md py-1.5 text-xs font-medium transition-colors ${
                customization.typeScale === value ? CHIP_ACTIVE : CHIP_INACTIVE
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <div className="border-t border-outline-variant/20" />

      {/* Advanced: custom CSS variables */}
      <section>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant"
        >
          <span className="material-symbols-outlined text-[14px]">
            {showAdvanced ? "expand_less" : "expand_more"}
          </span>
          Advanced
        </button>
        {showAdvanced && (
          <div className="mt-2 space-y-2">
            <p className="text-[9px] text-on-surface-variant leading-relaxed">
              Add custom CSS variable overrides. Variable names should not include the -- prefix.
              Values are applied to :root.
            </p>
            <div className="bg-surface-container rounded-lg p-2 text-[10px] font-mono text-on-surface-variant">
              {Object.entries(customization.customVars).length === 0 ? (
                <span className="italic">No custom variables set</span>
              ) : (
                Object.entries(customization.customVars).map(([key, val]) => (
                  <div key={key} className="flex justify-between">
                    <span>--{key}</span>
                    <span className="text-on-surface">{val}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
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

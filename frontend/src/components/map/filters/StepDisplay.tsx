import { getPalette, type PaletteKey } from "../../../lib/choropleth/palettes";
import { useIsDark } from "../../../context/ThemeContext";

interface StepDisplayProps {
  choroplethOn: boolean;
  onToggleChoropleth: () => void;
  heatmapOn: boolean;
  onToggleHeatmap: () => void;
  palette: PaletteKey;
  onSetPalette: (p: PaletteKey) => void;
  countyBoundaries: boolean;
  onToggleBoundaries: () => void;
}

const PALETTE_OPTIONS: { key: PaletteKey; label: string }[] = [
  { key: "default", label: "Default" },
  { key: "warm", label: "Warm" },
  { key: "cool", label: "Cool" },
  { key: "colorblind", label: "Colorblind Safe" },
];

function Toggle({ enabled, onToggle, label }: { enabled: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center justify-between w-full py-2"
    >
      <span className="text-sm text-on-surface">{label}</span>
      <div className={`w-10 h-5 rounded-full relative transition-colors ${
        enabled ? "bg-primary" : "bg-surface-container-high"
      }`}>
        <div className={`absolute top-0.5 w-4 h-4 bg-surface-container-lowest rounded-full transition-all ${
          enabled ? "right-0.5" : "left-0.5"
        }`} />
      </div>
    </button>
  );
}

export default function StepDisplay({
  choroplethOn,
  onToggleChoropleth,
  heatmapOn,
  onToggleHeatmap,
  palette,
  onSetPalette,
  countyBoundaries,
  onToggleBoundaries,
}: StepDisplayProps) {
  const isDark = useIsDark();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold text-on-surface mb-1">Map display settings</h3>
        <p className="text-[11px] text-on-surface-variant leading-snug">
          Control how the map looks. At least one of choropleth or heatmap must be on.
        </p>
      </div>

      <div className="space-y-1">
        <Toggle label="Choropleth (county colors)" enabled={choroplethOn} onToggle={onToggleChoropleth} />
        <Toggle label="Crash heatmap" enabled={heatmapOn} onToggle={onToggleHeatmap} />
        <Toggle label="County boundaries" enabled={countyBoundaries} onToggle={onToggleBoundaries} />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-bold text-on-surface">Color palette</h3>
        <div className="space-y-2">
          {PALETTE_OPTIONS.map((p) => {
            const colors = getPalette(p.key, isDark);
            return (
              <button
                key={p.key}
                onClick={() => onSetPalette(p.key)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                  palette === p.key
                    ? "bg-primary-container"
                    : "bg-surface-container-high hover:bg-surface-variant"
                }`}
              >
                <div className="flex gap-0.5">
                  {colors.map((c, i) => (
                    <div key={i} className="w-5 h-5 rounded-sm" style={{ backgroundColor: c }} />
                  ))}
                </div>
                <span className={`text-xs font-semibold ${
                  palette === p.key ? "text-on-primary-container" : "text-on-surface-variant"
                }`}>
                  {p.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

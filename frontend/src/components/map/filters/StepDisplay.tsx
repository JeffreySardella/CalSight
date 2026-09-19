import { getPalette, type PaletteKey } from "../../../lib/choropleth/palettes";
import { useIsDark } from "../../../context/ThemeContext";
import { DANGER_NO_DATA_COLOR, dangerColors } from "../../../lib/map/dangerRamp";

interface StepDisplayProps {
  choroplethOn: boolean;
  onToggleChoropleth: () => void;
  heatmapOn: boolean;
  onToggleHeatmap: () => void;
  palette: PaletteKey;
  onSetPalette: (p: PaletteKey) => void;
  countyBoundaries: boolean;
  onToggleBoundaries: () => void;
  hospitalsOn: boolean;
  onToggleHospitals: () => void;
  schoolsOn: boolean;
  onToggleSchools: () => void;
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

/**
 * Ramp key for the school markers, shown only while the layer is on.
 *
 * The caveat is not optional garnish: coordinate coverage is ~37% statewide
 * and varies by reporting agency, so a gray marker often means "these crashes
 * were never geocoded" rather than "nothing happened here". Putting that next
 * to the toggle — not only in /about — is the whole reason this legend exists.
 */
function SchoolCrashLegend({ palette, isDark }: { palette: PaletteKey; isDark: boolean }) {
  return (
    <div className="pl-1 pb-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span
          className="w-3 h-3 rounded-full border border-surface-container-lowest"
          style={{ backgroundColor: DANGER_NO_DATA_COLOR }}
        />
        <span className="text-[11px] text-on-surface-variant">none</span>
        {dangerColors(palette, isDark).map((c) => (
          <span
            key={c}
            className="w-3 h-3 rounded-full border border-surface-container-lowest"
            style={{ backgroundColor: c }}
          />
        ))}
        <span className="text-[11px] text-on-surface-variant">most crashes within 500 ft</span>
      </div>
      <p className="text-[11px] text-on-surface-variant leading-snug">
        Counts cover all crashes in the selected years and ignore the other filters. Only crashes
        with map coordinates count, and coverage varies by county — schools in low-coverage
        counties look safer than they are.
      </p>
    </div>
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
  hospitalsOn,
  onToggleHospitals,
  schoolsOn,
  onToggleSchools,
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
        <Toggle label="Hospitals" enabled={hospitalsOn} onToggle={onToggleHospitals} />
        <Toggle label="Schools" enabled={schoolsOn} onToggle={onToggleSchools} />
        {schoolsOn && <SchoolCrashLegend palette={palette} isDark={isDark} />}
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

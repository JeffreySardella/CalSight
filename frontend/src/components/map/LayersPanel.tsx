import { useEffect } from "react";
import { useLayersState, type OtherLayerKey } from "../../hooks/useLayersState";
import { MEASURES } from "../../lib/choropleth/measures";
import { PALETTES, getPalette, type PaletteKey } from "../../lib/choropleth/palettes";
import { useIsDark } from "../../context/ThemeContext";

interface ToggleProps {
  enabled: boolean;
  onToggle: () => void;
}

function Toggle({ enabled, onToggle }: ToggleProps) {
  return (
    <button
      onClick={onToggle}
      className={`w-8 h-4 rounded-full relative transition-colors ${
        enabled ? "bg-primary" : "bg-surface-container-high"
      }`}
    >
      <div
        className={`absolute top-0.5 w-3 h-3 bg-surface-container-lowest rounded-full transition-all ${
          enabled ? "right-0.5" : "left-0.5"
        }`}
      />
    </button>
  );
}

const MAP_FEATURE_LAYERS: { key: OtherLayerKey; label: string }[] = [
  { key: "countyBoundaries", label: "County Boundaries" },
  { key: "roadTypes", label: "Road Types" },
  { key: "schoolZones", label: "School Zones" },
  { key: "hospitals", label: "Hospitals" },
];

const PALETTE_LABELS: Record<PaletteKey, string> = {
  default: "Default",
  warm: "Warm",
  cool: "Cool",
  colorblind: "Colorblind Safe",
};

export default function LayersPanel() {
  const {
    choroplethOn, setChoroplethOn,
    measure, setMeasure,
    palette: activePalette, setPalette,
    otherLayers, toggleOtherLayer,
    reset,
  } = useLayersState();
  const isDark = useIsDark();

  useEffect(() => {
    function handleReset() {
      reset();
    }
    window.addEventListener("layers:reset-defaults", handleReset);
    return () => window.removeEventListener("layers:reset-defaults", handleReset);
  }, [reset]);

  return (
    <div className="space-y-8 pb-32 px-0">
      {/* Data Visualization */}
      <div className="space-y-4">
        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          Data Visualization
        </label>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className={`text-sm font-medium ${choroplethOn ? "text-on-surface" : "text-on-surface-variant"}`}>
              Choropleth
            </span>
            <Toggle enabled={choroplethOn} onToggle={() => setChoroplethOn(!choroplethOn)} />
          </div>
          <div className="flex justify-between items-center">
            <span className={`text-sm font-medium ${otherLayers.heatmap ? "text-on-surface" : "text-on-surface-variant"}`}>
              Heatmap
            </span>
            <Toggle enabled={otherLayers.heatmap} onToggle={() => toggleOtherLayer("heatmap")} />
          </div>
          <div className="flex justify-between items-center">
            <span className={`text-sm font-medium ${otherLayers.incidents ? "text-on-surface" : "text-on-surface-variant"}`}>
              Incident Points
            </span>
            <Toggle enabled={otherLayers.incidents} onToggle={() => toggleOtherLayer("incidents")} />
          </div>
        </div>
      </div>

      {/* Measure */}
      <div className="space-y-4">
        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          Measure
        </label>
        <div className="space-y-2">
          {Object.values(MEASURES).map((m) => {
            const active = measure === m.key;
            return (
              <button
                key={m.key}
                onClick={() => setMeasure(m.key)}
                className="flex items-center gap-3 w-full text-left cursor-pointer"
              >
                <span className={`w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center transition-colors ${
                  active ? "bg-primary" : "bg-surface-container-high"
                }`}>
                  {active && <span className="w-1.5 h-1.5 rounded-full bg-on-primary" />}
                </span>
                <span className={`text-sm ${active ? "text-on-surface font-medium" : "text-on-surface-variant"}`}>
                  {m.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Map Features */}
      <div className="space-y-4">
        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          Map Features
        </label>
        <div className="space-y-3">
          {MAP_FEATURE_LAYERS.map(({ key, label }) => (
            <div key={key} className="flex justify-between items-center">
              <span className={`text-sm font-medium ${otherLayers[key] ? "text-on-surface" : "text-on-surface-variant"}`}>
                {label}
              </span>
              <Toggle enabled={otherLayers[key]} onToggle={() => toggleOtherLayer(key)} />
            </div>
          ))}
        </div>
      </div>

      {/* Color Palette */}
      <div className="space-y-4">
        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          Color Palette
        </label>
        <div className="grid grid-cols-2 gap-3">
          {(Object.keys(PALETTES) as PaletteKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setPalette(key)}
              className={`p-2 rounded-xl text-left transition-all ${
                activePalette === key ? "bg-primary-container" : "hover:bg-surface-container"
              }`}
            >
              <div
                className="h-12 w-full rounded-lg mb-2"
                style={{ background: `linear-gradient(to right, ${getPalette(key, isDark).join(", ")})` }}
              />
              <span className={`text-[10px] font-semibold block text-center ${
                activePalette === key ? "text-on-primary-container" : "text-on-surface-variant"
              }`}>
                {PALETTE_LABELS[key]}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function LayersPanelFooter() {
  return (
    <button
      onClick={() => {
        console.log("Layers reset to defaults");
        window.dispatchEvent(new CustomEvent("layers:reset-defaults"));
      }}
      className="w-full bg-surface-container-high text-on-surface-variant py-4 rounded-md text-[11px] font-bold tracking-[0.2em] uppercase hover:opacity-90 transition-all"
    >
      Reset to Defaults
    </button>
  );
}

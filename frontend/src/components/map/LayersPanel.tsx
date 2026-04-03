import { useState, useEffect } from "react";

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

type LayerKey =
  | "choropleth"
  | "heatmap"
  | "incidents"
  | "countyBoundaries"
  | "roadTypes"
  | "schoolZones"
  | "hospitals";

type PaletteKey = "default" | "warm" | "cool" | "colorblind";

const DATA_VIZ_LAYERS: { key: LayerKey; label: string }[] = [
  { key: "choropleth", label: "Choropleth" },
  { key: "heatmap", label: "Heatmap" },
  { key: "incidents", label: "Incident Points" },
];

const MAP_FEATURE_LAYERS: { key: LayerKey; label: string }[] = [
  { key: "countyBoundaries", label: "County Boundaries" },
  { key: "roadTypes", label: "Road Types" },
  { key: "schoolZones", label: "School Zones" },
  { key: "hospitals", label: "Hospitals" },
];

const PALETTES: { key: PaletteKey; label: string; gradient: string }[] = [
  {
    key: "default",
    label: "Default",
    gradient: "bg-gradient-to-r from-slate-400 to-primary",
  },
  {
    key: "warm",
    label: "Warm",
    gradient: "bg-gradient-to-r from-amber-400 to-red-500",
  },
  {
    key: "cool",
    label: "Cool",
    gradient: "bg-gradient-to-r from-teal-400 to-green-500",
  },
  {
    key: "colorblind",
    label: "Colorblind Safe",
    gradient: "bg-gradient-to-r from-orange-400 via-white to-blue-500",
  },
];

const INITIAL_LAYERS: Record<LayerKey, boolean> = {
  choropleth: true,
  heatmap: false,
  incidents: false,
  countyBoundaries: true,
  roadTypes: false,
  schoolZones: false,
  hospitals: false,
};

export default function LayersPanel() {
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>(
    () => ({ ...INITIAL_LAYERS }),
  );

  const [activePalette, setActivePalette] = useState<PaletteKey>("default");

  useEffect(() => {
    function handleReset() {
      setLayers({ ...INITIAL_LAYERS });
      setActivePalette("default");
    }
    window.addEventListener("layers:reset-defaults", handleReset);
    return () => window.removeEventListener("layers:reset-defaults", handleReset);
  }, []);

  function toggleLayer(key: LayerKey) {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="space-y-8 pb-32 px-0">
      {/* Data Visualization */}
      <div className="space-y-4">
        <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
          Data Visualization
        </label>
        <div className="space-y-3">
          {DATA_VIZ_LAYERS.map(({ key, label }) => (
            <div key={key} className="flex justify-between items-center">
              <span
                className={`text-sm font-medium ${
                  layers[key] ? "text-on-surface" : "text-on-surface-variant"
                }`}
              >
                {label}
              </span>
              <Toggle
                enabled={layers[key]}
                onToggle={() => toggleLayer(key)}
              />
            </div>
          ))}
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
              <span
                className={`text-sm font-medium ${
                  layers[key] ? "text-on-surface" : "text-on-surface-variant"
                }`}
              >
                {label}
              </span>
              <Toggle
                enabled={layers[key]}
                onToggle={() => toggleLayer(key)}
              />
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
          {PALETTES.map(({ key, label, gradient }) => (
            <button
              key={key}
              onClick={() => setActivePalette(key)}
              className={`p-2 rounded-xl text-left transition-all ${
                activePalette === key
                  ? "bg-primary-container"
                  : "hover:bg-surface-container"
              }`}
            >
              <div className={`h-12 w-full rounded-lg ${gradient} mb-2`} />
              <span
                className={`text-[10px] font-semibold block text-center ${
                  activePalette === key
                    ? "text-on-primary-container"
                    : "text-on-surface-variant"
                }`}
              >
                {label}
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

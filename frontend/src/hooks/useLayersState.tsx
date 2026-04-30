import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_MEASURE, MEASURES, type MeasureKey } from "../lib/choropleth/measures";
import { PALETTES, type PaletteKey } from "../lib/choropleth/palettes";

export type OtherLayerKey = "heatmapStatewide" | "heatmapCounty" | "incidents" | "countyBoundaries" | "roadTypes" | "schoolZones" | "hospitals";
export type HeatmapResolution = "raw" | "low" | "medium" | "high";

const OTHER_LAYER_DEFAULTS: Record<OtherLayerKey, boolean> = {
  heatmapStatewide: false,
  heatmapCounty: true,
  incidents: false,
  countyBoundaries: true,
  roadTypes: false,
  schoolZones: false,
  hospitals: false,
};

const STORAGE_KEY = "calsight-layers";
const VALID_RESOLUTIONS = new Set<HeatmapResolution>(["raw", "low", "medium", "high"]);

type SavedLayers = {
  measure?: MeasureKey;
  palette?: PaletteKey;
  choroplethOn?: boolean;
  resolution?: HeatmapResolution;
  otherLayers?: Partial<Record<OtherLayerKey, boolean>>;
};

function loadSaved(): SavedLayers {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const result: SavedLayers = {
      measure: parsed.measure && parsed.measure in MEASURES ? parsed.measure : undefined,
      palette: parsed.palette && parsed.palette in PALETTES ? parsed.palette : undefined,
      choroplethOn: typeof parsed.choroplethOn === "boolean" ? parsed.choroplethOn : undefined,
      resolution: parsed.resolution && VALID_RESOLUTIONS.has(parsed.resolution) ? parsed.resolution : undefined,
    };
    if (parsed.otherLayers && typeof parsed.otherLayers === "object") {
      const valid: Partial<Record<OtherLayerKey, boolean>> = {};
      for (const key of Object.keys(OTHER_LAYER_DEFAULTS) as OtherLayerKey[]) {
        if (typeof parsed.otherLayers[key] === "boolean") {
          valid[key] = parsed.otherLayers[key];
        }
      }
      result.otherLayers = valid;
    }
    return result;
  } catch {
    return {};
  }
}

type LayersState = {
  choroplethOn: boolean;
  measure: MeasureKey;
  palette: PaletteKey;
  /** Derived — set by CountyBoundaries on moveend; read by ChoroplethLegend.
   *  `null` when fewer than MIN_BUCKET_SUBSET visible counties. */
  bucketEdges: number[] | null;
  otherLayers: Record<OtherLayerKey, boolean>;

  setChoroplethOn: (v: boolean) => void;
  setMeasure: (m: MeasureKey) => void;
  setPalette: (p: PaletteKey) => void;
  setBucketEdges: (e: number[] | null) => void;
  toggleOtherLayer: (key: OtherLayerKey) => void;
  setOtherLayer: (key: OtherLayerKey, value: boolean) => void;
  heatmapResolution: HeatmapResolution;
  setHeatmapResolution: (r: HeatmapResolution) => void;
  reset: () => void;
};

const LayersStateContext = createContext<LayersState | null>(null);

export function LayersStateProvider({ children }: { children: ReactNode }) {
  const saved = loadSaved();
  const [choroplethOn, setChoroplethOn] = useState(saved.choroplethOn ?? true);
  const [measure, setMeasure] = useState<MeasureKey>(saved.measure ?? DEFAULT_MEASURE);
  const [palette, setPalette] = useState<PaletteKey>(saved.palette ?? "default");
  const [bucketEdges, setBucketEdges] = useState<number[] | null>(null);
  const [otherLayers, setOtherLayers] = useState<Record<OtherLayerKey, boolean>>(() => ({
    ...OTHER_LAYER_DEFAULTS,
    ...saved.otherLayers,
  }));
  const [heatmapResolution, setHeatmapResolution] = useState<HeatmapResolution>(saved.resolution ?? "low");

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        measure, palette, choroplethOn, resolution: heatmapResolution, otherLayers,
      }));
    } catch { /* quota exceeded — ignore */ }
  }, [measure, palette, choroplethOn, heatmapResolution, otherLayers]);

  const reset = useCallback(() => {
    setChoroplethOn(true);
    setMeasure(DEFAULT_MEASURE);
    setPalette("default");
    setBucketEdges(null);
    setOtherLayers({ ...OTHER_LAYER_DEFAULTS });
    setHeatmapResolution("low");
  }, []);

  const toggleOtherLayer = useCallback((key: OtherLayerKey) => {
    setOtherLayers((p) => ({ ...p, [key]: !p[key] }));
  }, []);

  const setOtherLayer = useCallback((key: OtherLayerKey, value: boolean) => {
    setOtherLayers((p) => ({ ...p, [key]: value }));
  }, []);

  const value = useMemo<LayersState>(
    () => ({
      choroplethOn, measure, palette, bucketEdges, otherLayers,
      setChoroplethOn, setMeasure, setPalette, setBucketEdges, toggleOtherLayer, setOtherLayer,
      heatmapResolution, setHeatmapResolution,
      reset,
    }),
    [choroplethOn, measure, palette, bucketEdges, otherLayers, toggleOtherLayer, heatmapResolution, reset],
  );

  return <LayersStateContext.Provider value={value}>{children}</LayersStateContext.Provider>;
}

export function useLayersState(): LayersState {
  const ctx = useContext(LayersStateContext);
  if (!ctx) throw new Error("useLayersState must be used inside <LayersStateProvider>");
  return ctx;
}

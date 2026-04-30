import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_MEASURE, type MeasureKey } from "../lib/choropleth/measures";
import type { PaletteKey } from "../lib/choropleth/palettes";

export type OtherLayerKey = "heatmapStatewide" | "heatmapCounty" | "incidents" | "countyBoundaries" | "roadTypes" | "schoolZones" | "hospitals";
export type HeatmapResolution = "raw" | "low" | "medium" | "high";

const OTHER_LAYER_DEFAULTS: Record<OtherLayerKey, boolean> = {
  heatmapStatewide: false,
  heatmapCounty: false,
  incidents: false,
  countyBoundaries: true,
  roadTypes: false,
  schoolZones: false,
  hospitals: false,
};

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
  heatmapResolution: HeatmapResolution;
  setHeatmapResolution: (r: HeatmapResolution) => void;
  reset: () => void;
};

const LayersStateContext = createContext<LayersState | null>(null);

export function LayersStateProvider({ children }: { children: ReactNode }) {
  const [choroplethOn, setChoroplethOn] = useState(true);
  const [measure, setMeasure] = useState<MeasureKey>(DEFAULT_MEASURE);
  const [palette, setPalette] = useState<PaletteKey>("default");
  const [bucketEdges, setBucketEdges] = useState<number[] | null>(null);
  const [otherLayers, setOtherLayers] = useState<Record<OtherLayerKey, boolean>>(() => ({ ...OTHER_LAYER_DEFAULTS }));
  const [heatmapResolution, setHeatmapResolution] = useState<HeatmapResolution>("low");

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

  const value = useMemo<LayersState>(
    () => ({
      choroplethOn, measure, palette, bucketEdges, otherLayers,
      setChoroplethOn, setMeasure, setPalette, setBucketEdges, toggleOtherLayer,
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

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { safeGetItem, safeSetItem } from "../lib/safeStorage";
import { DEFAULT_MEASURE, MEASURES, type MeasureKey } from "../lib/choropleth/measures";
import { PALETTES, type PaletteKey } from "../lib/choropleth/palettes";
import type { HighwaySort } from "./useHighwayRankings";
import { useCustomTheme } from "../context/CustomThemeContext";
import type { ChartPaletteKey } from "../lib/theme/types";

const THEME_TO_MAP_PALETTE: Record<ChartPaletteKey, PaletteKey> = {
  default: "default",
  warm: "warm",
  cool: "cool",
  ocean: "cool",
  forest: "cool",
  sunset: "warm",
  colorblind: "colorblind",
  monochrome: "default",
  custom: "default",
};

export type OtherLayerKey = "heatmapStatewide" | "heatmapCounty" | "coordMismatches" | "coordIncludeRivers" | "incidents" | "countyBoundaries" | "roadTypes" | "schools" | "hospitals" | "highwayDanger" | "topIntersections" | "crashClusters" | "reservoirs";
export type HeatmapResolution = "raw" | "low" | "medium" | "high";

/** The shareable subset of layer state that round-trips through the URL. See useLayerParams. */
export type LayerUrlState = {
  measure: MeasureKey;
  palette: PaletteKey;
  choroplethOn: boolean;
  heatmapResolution: HeatmapResolution;
  heatmapStatewide: boolean;
  heatmapCounty: boolean;
};

const OTHER_LAYER_DEFAULTS: Record<OtherLayerKey, boolean> = {
  heatmapStatewide: false,
  heatmapCounty: true,
  coordMismatches: false,
  coordIncludeRivers: false,
  incidents: false,
  countyBoundaries: true,
  roadTypes: false,
  schools: false,
  hospitals: false,
  highwayDanger: false,
  topIntersections: false,
  crashClusters: false,
  reservoirs: false,
};

const STORAGE_KEY = "calsight-layers";
// Bumped when a saved blob holds values the user never chose. v2 drops the
// heatmap toggles from pre-v2 blobs: an earlier auto-disable wrote them off
// whenever 3+ counties were selected and that stuck across reloads, leaving
// the heatmap dark for good. Everything else in the blob is honoured as-is.
const SAVED_VERSION = 2;
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
    const raw = safeGetItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const result: SavedLayers = {
      measure: parsed.measure && parsed.measure in MEASURES ? parsed.measure : undefined,
      palette: parsed.palette && parsed.palette in PALETTES ? parsed.palette : undefined,
      choroplethOn: typeof parsed.choroplethOn === "boolean" ? parsed.choroplethOn : undefined,
      resolution: parsed.resolution && VALID_RESOLUTIONS.has(parsed.resolution) ? parsed.resolution : undefined,
    };
    if (parsed.otherLayers && typeof parsed.otherLayers === "object") {
      const stale = parsed.v !== SAVED_VERSION;
      const valid: Partial<Record<OtherLayerKey, boolean>> = {};
      for (const key of Object.keys(OTHER_LAYER_DEFAULTS) as OtherLayerKey[]) {
        // Pre-v2 heatmap toggles may be the auto-disable's doing rather than
        // the user's — fall back to the defaults for those once.
        if (stale && (key === "heatmapCounty" || key === "heatmapStatewide")) continue;
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
  /** Which danger metric colors the Highway-danger layer lines. */
  highwayMetric: HighwaySort;

  setChoroplethOn: (v: boolean) => void;
  setHighwayMetric: (m: HighwaySort) => void;
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

export function LayersStateProvider({
  children,
  urlSeed,
  onStateChange,
}: {
  children: ReactNode;
  /** Layer state decoded from the URL — wins over localStorage on first mount. */
  urlSeed?: Partial<LayerUrlState>;
  /** Called whenever layer state changes, so MapPage can mirror it to the URL. */
  onStateChange?: (state: LayerUrlState) => void;
}) {
  // Lazy initializer: parse localStorage exactly once on mount rather than on
  // every render. The result only seeds the useState initializers below, so it
  // is never needed again after the first render.
  const [saved] = useState(loadSaved);
  const { customization } = useCustomTheme();
  const [choroplethOn, setChoroplethOn] = useState(urlSeed?.choroplethOn ?? saved.choroplethOn ?? true);
  const [measure, setMeasure] = useState<MeasureKey>(urlSeed?.measure ?? saved.measure ?? DEFAULT_MEASURE);
  const [palette, setPalette] = useState<PaletteKey>(urlSeed?.palette ?? saved.palette ?? "default");
  const isFirstSync = useRef(true);
  const [bucketEdges, setBucketEdges] = useState<number[] | null>(null);
  const [otherLayers, setOtherLayers] = useState<Record<OtherLayerKey, boolean>>(() => ({
    ...OTHER_LAYER_DEFAULTS,
    ...saved.otherLayers,
    ...(urlSeed?.heatmapStatewide !== undefined ? { heatmapStatewide: urlSeed.heatmapStatewide } : {}),
    ...(urlSeed?.heatmapCounty !== undefined ? { heatmapCounty: urlSeed.heatmapCounty } : {}),
  }));
  const [heatmapResolution, setHeatmapResolution] = useState<HeatmapResolution>(
    urlSeed?.heatmapResolution ?? saved.resolution ?? "low",
  );
  const [highwayMetric, setHighwayMetric] = useState<HighwaySort>("fatality_rate");

  useEffect(() => {
    safeSetItem(STORAGE_KEY, JSON.stringify({
      v: SAVED_VERSION, measure, palette, choroplethOn, resolution: heatmapResolution, otherLayers,
    }));
    onStateChange?.({
      measure, palette, choroplethOn, heatmapResolution,
      heatmapStatewide: otherLayers.heatmapStatewide,
      heatmapCounty: otherLayers.heatmapCounty,
    });
  }, [measure, palette, choroplethOn, heatmapResolution, otherLayers, onStateChange]);

  // Sync map palette when the Settings theme palette changes
  useEffect(() => {
    if (isFirstSync.current) {
      isFirstSync.current = false;
      return;
    }
    const mapped = THEME_TO_MAP_PALETTE[customization.chart.palette];
    if (mapped && mapped !== palette) {
      setPalette(mapped);
    }
  }, [customization.chart.palette]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = useCallback(() => {
    setChoroplethOn(true);
    setMeasure(DEFAULT_MEASURE);
    setPalette("default");
    setBucketEdges(null);
    setOtherLayers({ ...OTHER_LAYER_DEFAULTS });
    setHeatmapResolution("low");
    setHighwayMetric("fatality_rate");
  }, []);

  const toggleOtherLayer = useCallback((key: OtherLayerKey) => {
    setOtherLayers((p) => ({ ...p, [key]: !p[key] }));
  }, []);

  const setOtherLayer = useCallback((key: OtherLayerKey, value: boolean) => {
    setOtherLayers((p) => ({ ...p, [key]: value }));
  }, []);

  const value = useMemo<LayersState>(
    () => ({
      choroplethOn, measure, palette, bucketEdges, otherLayers, highwayMetric,
      setChoroplethOn, setMeasure, setPalette, setBucketEdges, toggleOtherLayer, setOtherLayer,
      setHighwayMetric,
      heatmapResolution, setHeatmapResolution,
      reset,
    }),
    [choroplethOn, measure, palette, bucketEdges, otherLayers, highwayMetric, toggleOtherLayer, heatmapResolution, reset],
  );

  return <LayersStateContext.Provider value={value}>{children}</LayersStateContext.Provider>;
}

export function useLayersState(): LayersState {
  const ctx = useContext(LayersStateContext);
  if (!ctx) throw new Error("useLayersState must be used inside <LayersStateProvider>");
  return ctx;
}

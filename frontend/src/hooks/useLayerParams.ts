import { useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { MEASURES, DEFAULT_MEASURE, type MeasureKey } from "../lib/choropleth/measures";
import { PALETTES, type PaletteKey } from "../lib/choropleth/palettes";
import type { HeatmapResolution, LayerUrlState } from "./useLayersState";

/**
 * Mirrors the shareable subset of map-layer state into the URL so a copied
 * link reproduces what the viewer is looking at — which measure colours the
 * choropleth, the palette, and the active heatmap/dots layer.
 *
 * LayersStateProvider stays Router-agnostic: this hook lives in MapPage (which
 * is inside <BrowserRouter>) and feeds the provider a `urlSeed` prop + an
 * `onStateChange` callback. `layerSeed` is read ONCE on mount (frozen in a
 * ref); writes never feed back into the provider, so there is no loop.
 *
 * Encoding (every param omitted when at its default → clean URLs):
 *   measure  — choropleth MeasureKey   (default: crashes_per_100k)
 *   palette  — PaletteKey              (default: default)
 *   choro    — "0" when choropleth off (default: on)
 *   hres     — heatmap resolution      (default: low; "raw" = dots)
 *   heatmap  — "statewide" | "off"     (default: county)
 */

const VALID_RESOLUTIONS = new Set<HeatmapResolution>(["raw", "low", "medium", "high"]);

/** Decode the layer params present in the URL. Unknown/invalid values are dropped. */
export function parseLayerParams(searchParams: URLSearchParams): Partial<LayerUrlState> {
  const seed: Partial<LayerUrlState> = {};

  const measure = searchParams.get("measure");
  if (measure && measure in MEASURES) seed.measure = measure as MeasureKey;

  const palette = searchParams.get("palette");
  if (palette && palette in PALETTES) seed.palette = palette as PaletteKey;

  const choro = searchParams.get("choro");
  if (choro === "0") seed.choroplethOn = false;
  else if (choro === "1") seed.choroplethOn = true;

  const hres = searchParams.get("hres");
  if (hres && VALID_RESOLUTIONS.has(hres as HeatmapResolution)) {
    seed.heatmapResolution = hres as HeatmapResolution;
  }

  const heatmap = searchParams.get("heatmap");
  if (heatmap === "statewide") {
    seed.heatmapStatewide = true;
    seed.heatmapCounty = false;
  } else if (heatmap === "off") {
    seed.heatmapStatewide = false;
    seed.heatmapCounty = false;
  } else if (heatmap === "county") {
    seed.heatmapStatewide = false;
    seed.heatmapCounty = true;
  }

  return seed;
}

export function useLayerParams() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Frozen at first render — see module docstring.
  const seedRef = useRef<Partial<LayerUrlState> | null>(null);
  if (seedRef.current === null) {
    seedRef.current = parseLayerParams(searchParams);
  }

  const writeLayerParams = useCallback(
    (s: LayerUrlState) => {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);

        if (s.measure !== DEFAULT_MEASURE) p.set("measure", s.measure);
        else p.delete("measure");

        if (s.palette !== "default") p.set("palette", s.palette);
        else p.delete("palette");

        if (!s.choroplethOn) p.set("choro", "0");
        else p.delete("choro");

        if (s.heatmapResolution !== "low") p.set("hres", s.heatmapResolution);
        else p.delete("hres");

        // County-only heatmap is the default — omit it; encode the rest.
        // If both heatmaps are on, statewide wins (a rare, lossy edge case).
        if (s.heatmapStatewide) p.set("heatmap", "statewide");
        else if (!s.heatmapCounty) p.set("heatmap", "off");
        else p.delete("heatmap");

        return p;
      }, { replace: true });
    },
    [setSearchParams],
  );

  return { layerSeed: seedRef.current, writeLayerParams };
}

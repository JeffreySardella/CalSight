import { memo, useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";
import type { HeatmapPoint } from "../../hooks/useCrashHeatmap";
import type { HeatmapResolution } from "../../hooks/useLayersState";
import type { PaletteKey } from "../../lib/choropleth/palettes";
import { getPalette } from "../../lib/choropleth/palettes";
import { useIsDark } from "../../context/ThemeContext";
import { useDesignTokens } from "../../hooks/useDesignTokens";
import { heatOpacityForZoom } from "../../lib/map/heatmapLod";

/**
 * Private leaflet.heat internals this component relies on. These are not part
 * of the public HeatLayer type (see src/types/leaflet.heat.d.ts), so access is
 * funneled through {@link heatInternals} — the single, documented cast — rather
 * than scattering `as unknown as` assertions at every use site.
 */
interface HeatLayerInternals {
  _canvas?: HTMLCanvasElement;
  _animateZoom: (e: L.ZoomAnimEvent) => void;
  _reset: () => void;
  _redraw: () => void;
  /** Set by leaflet.heat's redraw() while a requestAnimationFrame-scheduled
   *  _redraw() is in flight; see removeHeatLayer below. */
  _frame?: number;
}

function heatInternals(layer: L.HeatLayer): HeatLayerInternals {
  return layer as unknown as HeatLayerInternals;
}

/**
 * Add a heat layer that skips drawing while the map has no size.
 *
 * simpleheat's draw() ends in `ctx.getImageData(0, 0, width, height)`, which
 * throws IndexSizeError when either is 0 — the map container before its first
 * layout, or while the Map tab is hidden on mobile. `_frame` has to be cleared
 * on the skipped draw: leaflet.heat's redraw() refuses to schedule another
 * frame while it is set, so leaving it would freeze the layer for good. The
 * next `moveend` (Leaflet fires one from invalidateSize) draws it for real.
 * Wrapped before addTo() because onAdd() itself redraws.
 */
function addHeatLayer(map: L.Map, layer: L.HeatLayer): void {
  const internals = heatInternals(layer);
  const draw = internals._redraw;
  internals._redraw = function guardedRedraw(this: HeatLayerInternals) {
    const size = map.getSize();
    if (size.x === 0 || size.y === 0) {
      this._frame = undefined;
      return;
    }
    draw.call(this);
  };
  layer.addTo(map);
}

/**
 * Remove a heat layer without leaving a scheduled redraw behind.
 *
 * leaflet.heat's redraw() throttles via requestAnimationFrame(this._redraw),
 * storing the frame id on `_frame`. Its onRemove() nulls the canvas and event
 * listeners but never cancels that frame. Leaflet's own removeLayer() then
 * sets the layer's `_map` to null — so if a redraw was already scheduled
 * (e.g. a setLatLngs from a streaming batch, or the zoomend handler's
 * _reset()) and this layer is torn down before the next animation frame,
 * _redraw() fires afterward and throws reading `_map.getSize()` on null.
 * Cancelling here, in the one place every caller routes through, avoids
 * patching each removal site (and there are several below).
 */
function removeHeatLayer(map: L.Map, layer: L.HeatLayer): void {
  const frame = heatInternals(layer)._frame;
  if (frame != null) L.Util.cancelAnimFrame(frame);
  map.removeLayer(layer);
}

/**
 * Ease the heat canvas back as the crash dots take over (heatOpacityForZoom).
 * Canvas opacity is a compositor property: no redraw, no reprojection.
 */
function fadeForZoom(map: L.Map, layer: L.HeatLayer): void {
  const canvas = heatInternals(layer)._canvas;
  if (canvas) canvas.style.opacity = String(heatOpacityForZoom(map.getZoom()));
}

const BASE_RADIUS: Record<HeatmapResolution, number> = {
  raw: 8,
  low: 18,
  medium: 12,
  high: 8,
};

function radiusForZoom(base: number, zoom: number): number {
  const scale = Math.pow(2, zoom - 6) * 0.5;
  return Math.max(2, Math.round(base * scale));
}

function buildGradient(palette: PaletteKey, isDark: boolean, raw = false): Record<number, string> {
  const colors = getPalette(palette, isDark);
  if (raw) {
    const strong = colors[colors.length - 1];
    const mid = colors[Math.floor(colors.length * 0.6)];
    return { 0: "transparent", 0.3: mid, 1.0: strong };
  }
  const stops: Record<number, string> = { 0: "transparent" };
  colors.forEach((c, i) => {
    stops[(i + 1) / colors.length] = c;
  });
  return stops;
}

export function useHeatLayer(
  points: HeatmapPoint[],
  resolution: HeatmapResolution,
  palette: PaletteKey,
  isDark: boolean,
) {
  const map = useMap();
  const layerRef = useRef<L.HeatLayer | null>(null);
  const latlngsRef = useRef<[number, number, number][]>([]);

  // Layer creation/teardown — only when style config changes
  useEffect(() => {
    if (layerRef.current) {
      removeHeatLayer(map, layerRef.current);
      layerRef.current = null;
    }

    if (points.length === 0) return;

    let maxWeight = 0;
    for (const p of points) {
      if (p.weight > maxWeight) maxWeight = p.weight;
    }

    latlngsRef.current = points.map((p) => [
      p.lat,
      p.lng,
      p.weight / (maxWeight || 1),
    ]);

    const base = BASE_RADIUS[resolution];
    const isRaw = resolution === "raw";
    const gradient = buildGradient(palette, isDark, isRaw);
    const r = isRaw ? base : radiusForZoom(base, map.getZoom());
    const blur = isRaw ? Math.round(base * 0.6) : Math.max(1, Math.round(r * 0.3));

    const layer = L.heatLayer(latlngsRef.current, {
      radius: r,
      blur,
      max: 1,
      minOpacity: 0.25,
      gradient,
    });

    addHeatLayer(map, layer);
    layerRef.current = layer;

    const internals = heatInternals(layer);

    if (internals._canvas) {
      internals._canvas.style.pointerEvents = "none";
    }
    fadeForZoom(map, layer);

    // Keep leaflet.heat's own `zoomanim` handler bound. There are two ways to
    // survive a zoom: hide the canvas until zoomend (what this used to do), or
    // let _animateZoom CSS-transform it the way Leaflet transforms its own tile
    // layers. Only the second one holds position during a *pinch*: a touch
    // pinch drives map._animateZoom continuously, firing `zoomanim` on every
    // frame, so the transformed canvas tracks the gesture. Hiding it instead
    // showed an empty map for the whole gesture and then a redraw lag — the
    // "blanks during zoom" report. zoomend still calls _reset() below to
    // reproject at the settled zoom and clear the transform.
    const onZoomEnd = () => {
      if (!layerRef.current) return;
      const current = heatInternals(layerRef.current);
      if (!isRaw) {
        const z = map.getZoom();
        const newR = radiusForZoom(base, z);
        layerRef.current.setOptions({ radius: newR, blur: Math.max(1, Math.round(newR * 0.3)) });
      }
      fadeForZoom(map, layerRef.current);
      current._reset();
    };

    map.on("zoomend", onZoomEnd);

    return () => {
      map.off("zoomend", onZoomEnd);
      if (layerRef.current) {
        removeHeatLayer(map, layerRef.current);
        layerRef.current = null;
      }
    };
  // `points.length === 0` is included so the layer is (re)built when data
  // transitions empty→present. Without it, a cold load where points arrive
  // after this effect first runs would never create the layer — the data
  // effect below only calls setLatLngs on an already-existing layer. The
  // boolean stays stable across batch updates, so we still avoid teardown.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, resolution, palette, isDark, points.length === 0]);

  // Data updates — setLatLngs to avoid full teardown on each batch
  useEffect(() => {
    if (points.length === 0) {
      if (layerRef.current) {
        removeHeatLayer(map, layerRef.current);
        layerRef.current = null;
      }
      return;
    }

    let maxWeight = 0;
    for (const p of points) {
      if (p.weight > maxWeight) maxWeight = p.weight;
    }

    latlngsRef.current = points.map((p) => [
      p.lat,
      p.lng,
      p.weight / (maxWeight || 1),
    ]);

    if (layerRef.current) {
      layerRef.current.setLatLngs(latlngsRef.current);
    }
  }, [map, points]);

  return layerRef;
}

/**
 * Build fatal heatmap gradient from design tokens instead of hardcoded values.
 */
function buildFatalGradient(fatalLow: string, fatalMid: string, fatalHigh: string): Record<number, string> {
  return {
    0: "transparent",
    0.3: fatalLow,
    0.6: fatalMid,
    1.0: fatalHigh,
  };
}

/**
 * Fatal-crash emphasis layer. `points` must already be fatal-only — the heat
 * points it used to filter are now fetched with `detail=slim` (lat/lng/weight
 * and nothing else), so severity is no longer on them. MapPage runs a separate
 * `severity=Fatal` query instead; it is small enough to be cheaper than the
 * fifteen-field payload this used to sift through.
 */
export function useFatalLayer(
  points: HeatmapPoint[],
  resolution: HeatmapResolution,
  fatalGradient: Record<number, string>,
) {
  const map = useMap();
  const layerRef = useRef<L.HeatLayer | null>(null);

  useEffect(() => {
    if (layerRef.current) {
      removeHeatLayer(map, layerRef.current);
      layerRef.current = null;
    }

    if (resolution !== "raw") return;
    if (points.length === 0) return;

    const latlngs: [number, number, number][] = points.map((p) => [p.lat, p.lng, 1]);

    const layer = L.heatLayer(latlngs, {
      radius: 8,
      blur: 4,
      max: 1,
      minOpacity: 0.4,
      gradient: fatalGradient,
    });

    addHeatLayer(map, layer);
    layerRef.current = layer;

    const internals = heatInternals(layer);

    if (internals._canvas) {
      internals._canvas.style.pointerEvents = "none";
    }
    fadeForZoom(map, layer);

    // Same as useHeatLayer: leave `zoomanim` bound so the canvas is transformed
    // with the map during a pinch instead of being hidden for the gesture.
    const onZoomEnd = () => {
      if (!layerRef.current) return;
      fadeForZoom(map, layerRef.current);
      heatInternals(layerRef.current)._reset();
    };

    map.on("zoomend", onZoomEnd);

    return () => {
      map.off("zoomend", onZoomEnd);
      if (layerRef.current) {
        removeHeatLayer(map, layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, points, resolution, fatalGradient]);
}

interface CrashHeatmapProps {
  points: HeatmapPoint[];
  /** Fatal-only points for the emphasis layer; see useFatalLayer. */
  fatalPoints?: HeatmapPoint[];
  resolution: HeatmapResolution;
  palette: PaletteKey;
}

const NO_POINTS: HeatmapPoint[] = [];

export default memo(function CrashHeatmap({ points, fatalPoints = NO_POINTS, resolution, palette }: CrashHeatmapProps) {
  const isDark = useIsDark();
  const tokens = useDesignTokens();
  // Memoize on the token strings the gradient derives from (mirrors how
  // useHeatLayer depends only on primitives like isDark/palette). Without this,
  // a fresh object literal every render would make useFatalLayer's effect deps
  // change on each render, rebuilding the Leaflet heat layer every render.
  const fatalGradient = useMemo(
    () => buildFatalGradient(tokens.map.fatalLow, tokens.map.fatalMid, tokens.map.fatalHigh),
    [tokens.map.fatalLow, tokens.map.fatalMid, tokens.map.fatalHigh],
  );
  useHeatLayer(points, resolution, palette, isDark);
  useFatalLayer(fatalPoints, resolution, fatalGradient);
  return null;
});

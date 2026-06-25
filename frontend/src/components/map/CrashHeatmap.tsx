import { memo, useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";
import type { HeatmapPoint } from "../../hooks/useCrashHeatmap";
import type { HeatmapResolution } from "../../hooks/useLayersState";
import type { PaletteKey } from "../../lib/choropleth/palettes";
import { getPalette } from "../../lib/choropleth/palettes";
import { useIsDark } from "../../context/ThemeContext";
import { useDesignTokens } from "../../hooks/useDesignTokens";

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
      map.removeLayer(layerRef.current);
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

    layer.addTo(map);
    layerRef.current = layer;

    type HeatInternals = {
      _canvas: HTMLCanvasElement;
      _animateZoom: (e: L.ZoomAnimEvent) => void;
      _reset: () => void;
    };
    const internals = layer as unknown as HeatInternals;

    if (internals._canvas) {
      internals._canvas.style.pointerEvents = "none";
    }

    map.off("zoomanim", internals._animateZoom, layer);

    const onZoomStart = () => {
      if (!layerRef.current) return;
      const c = (layerRef.current as unknown as HeatInternals)._canvas;
      if (c) c.style.display = "none";
    };

    const onZoomEnd = () => {
      if (!layerRef.current) return;
      const cast = layerRef.current as unknown as HeatInternals;
      if (cast._canvas) cast._canvas.style.display = "";
      if (!isRaw) {
        const z = map.getZoom();
        const newR = radiusForZoom(base, z);
        layerRef.current.setOptions({ radius: newR, blur: Math.max(1, Math.round(newR * 0.3)) });
      }
      cast._reset();
    };

    map.on("zoomstart", onZoomStart);
    map.on("zoomend", onZoomEnd);

    return () => {
      map.off("zoomstart", onZoomStart);
      map.off("zoomend", onZoomEnd);
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
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
        map.removeLayer(layerRef.current);
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

function useFatalLayer(
  points: HeatmapPoint[],
  resolution: HeatmapResolution,
  fatalGradient: Record<number, string>,
) {
  const map = useMap();
  const layerRef = useRef<L.HeatLayer | null>(null);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    if (resolution !== "raw") return;

    const fatal = points.filter((p) => p.severity === "Fatal");
    if (fatal.length === 0) return;

    const latlngs: [number, number, number][] = fatal.map((p) => [p.lat, p.lng, 1]);

    const layer = L.heatLayer(latlngs, {
      radius: 8,
      blur: 4,
      max: 1,
      minOpacity: 0.4,
      gradient: fatalGradient,
    });

    layer.addTo(map);
    layerRef.current = layer;

    type HeatInternals = {
      _canvas: HTMLCanvasElement;
      _animateZoom: (e: L.ZoomAnimEvent) => void;
      _reset: () => void;
    };
    const internals = layer as unknown as HeatInternals;

    if (internals._canvas) {
      internals._canvas.style.pointerEvents = "none";
    }

    map.off("zoomanim", internals._animateZoom, layer);

    const onZoomStart = () => {
      const c = (layerRef.current as unknown as HeatInternals)?._canvas;
      if (c) c.style.display = "none";
    };
    const onZoomEnd = () => {
      const cast = layerRef.current as unknown as HeatInternals;
      if (cast?._canvas) cast._canvas.style.display = "";
      cast?._reset();
    };

    map.on("zoomstart", onZoomStart);
    map.on("zoomend", onZoomEnd);

    return () => {
      map.off("zoomstart", onZoomStart);
      map.off("zoomend", onZoomEnd);
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, points, resolution, fatalGradient]);
}

interface CrashHeatmapProps {
  points: HeatmapPoint[];
  resolution: HeatmapResolution;
  palette: PaletteKey;
}

export default memo(function CrashHeatmap({ points, resolution, palette }: CrashHeatmapProps) {
  const isDark = useIsDark();
  const tokens = useDesignTokens();
  const fatalGradient = buildFatalGradient(
    tokens.map.fatalLow,
    tokens.map.fatalMid,
    tokens.map.fatalHigh,
  );
  useHeatLayer(points, resolution, palette, isDark);
  useFatalLayer(points, resolution, fatalGradient);
  return null;
});

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";
import type { HeatmapPoint } from "../../hooks/useCrashHeatmap";
import type { HeatmapResolution } from "../../hooks/useLayersState";
import type { PaletteKey } from "../../lib/choropleth/palettes";
import { getPalette } from "../../lib/choropleth/palettes";
import { useIsDark } from "../../context/ThemeContext";

const BASE_RADIUS: Record<HeatmapResolution, number> = {
  raw: 5,
  low: 18,
  medium: 12,
  high: 8,
};

function radiusForZoom(base: number, zoom: number): number {
  const scale = Math.pow(2, zoom - 6) * 0.5;
  return Math.max(2, Math.round(base * scale));
}

function buildGradient(palette: PaletteKey, isDark: boolean): Record<number, string> {
  const colors = getPalette(palette, isDark);
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
    const gradient = buildGradient(palette, isDark);

    latlngsRef.current = points.map((p) => [
      p.lat,
      p.lng,
      p.weight / (maxWeight || 1),
    ]);

    const base = BASE_RADIUS[resolution];
    const isRaw = resolution === "raw";
    const r = isRaw ? base : radiusForZoom(base, map.getZoom());
    const blur = isRaw ? Math.round(base * 0.6) : Math.max(1, Math.round(r * 0.3));

    const layer = L.heatLayer(latlngsRef.current, {
      radius: r,
      blur,
      max: 1,
      minOpacity: 0.1,
      gradient,
    });

    layer.addTo(map);
    layerRef.current = layer;

    const onZoom = () => {
      if (!layerRef.current || isRaw) return;
      const z = map.getZoom();
      const newR = radiusForZoom(base, z);
      layerRef.current.setOptions({ radius: newR, blur: Math.max(1, Math.round(newR * 0.3)) });
      layerRef.current.redraw();
    };
    map.on("zoomend", onZoom);

    return () => {
      map.off("zoomend", onZoom);
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, points, resolution, palette, isDark]);

  return layerRef;
}

interface CrashHeatmapProps {
  points: HeatmapPoint[];
  resolution: HeatmapResolution;
  palette: PaletteKey;
}

export default function CrashHeatmap({ points, resolution, palette }: CrashHeatmapProps) {
  const isDark = useIsDark();
  useHeatLayer(points, resolution, palette, isDark);
  return null;
}

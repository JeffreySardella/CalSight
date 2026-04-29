import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";
import type { HeatmapPoint } from "../../hooks/useCrashHeatmap";
import type { HeatmapResolution } from "../../hooks/useLayersState";
import type { PaletteKey } from "../../lib/choropleth/palettes";
import { getPalette } from "../../lib/choropleth/palettes";
import { useIsDark } from "../../context/ThemeContext";

const HEAT_CONFIG: Record<HeatmapResolution, { radius: number; blur: number; max: number }> = {
  low: { radius: 20, blur: 25, max: 0 },
  medium: { radius: 15, blur: 20, max: 0 },
  high: { radius: 10, blur: 15, max: 0 },
};

const DEFAULT_GRADIENT: Record<number, string> = {
  0.0: "transparent",
  0.2: "#fef3c7",
  0.4: "#fcd34d",
  0.6: "#f59e0b",
  0.8: "#dc2626",
  1.0: "#7f1d1d",
};

function buildGradient(palette: PaletteKey, isDark: boolean): Record<number, string> {
  if (palette === "default") return DEFAULT_GRADIENT;
  const colors = getPalette(palette, isDark);
  const stops: Record<number, string> = { 0.0: "transparent" };
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

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    if (points.length === 0) return;

    const maxWeight = Math.max(...points.map((p) => p.weight));
    const config = HEAT_CONFIG[resolution];
    const gradient = buildGradient(palette, isDark);

    const latlngs: [number, number, number][] = points.map((p) => [
      p.lat,
      p.lng,
      p.weight / (maxWeight || 1),
    ]);

    const layer = L.heatLayer(latlngs, {
      radius: config.radius,
      blur: config.blur,
      maxZoom: 14,
      max: 1,
      gradient,
    });

    layer.addTo(map);
    layerRef.current = layer;

    return () => {
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

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { HeatmapPoint } from "../../hooks/useCrashHeatmap";
import type { PaletteKey } from "../../lib/choropleth/palettes";

const MISMATCH_COLORS: Record<PaletteKey, { color: string; fill: string }> = {
  default: { color: "#ef4444", fill: "#f97316" },
  warm: { color: "#7c3aed", fill: "#a78bfa" },
  cool: { color: "#e11d48", fill: "#fb7185" },
  colorblind: { color: "#0e8a9a", fill: "#17becf" },
};

interface Props {
  points: HeatmapPoint[];
  palette: PaletteKey;
}

const MISMATCH_PANE = "mismatchPane";

export default function CoordMismatchLayer({ points, palette }: Props) {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup | null>(null);
  const colors = MISMATCH_COLORS[palette];

  useEffect(() => {
    if (!map.getPane(MISMATCH_PANE)) {
      map.createPane(MISMATCH_PANE);
      map.getPane(MISMATCH_PANE)!.style.zIndex = "625";
    }
  }, [map]);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    if (points.length === 0) return;

    const markers = points.map((p) =>
      L.circleMarker([p.lat, p.lng], {
        radius: 5,
        color: colors.color,
        fillColor: colors.fill,
        fillOpacity: 0.9,
        weight: 2,
        pane: MISMATCH_PANE,
      })
    );

    const group = L.layerGroup(markers);
    group.addTo(map);
    layerRef.current = group;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, points, colors]);

  return null;
}

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { HeatmapPoint } from "../../hooks/useCrashHeatmap";

interface Props {
  points: HeatmapPoint[];
}

const MISMATCH_PANE = "mismatchPane";

export default function CoordMismatchLayer({ points }: Props) {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup | null>(null);

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
        color: "#ef4444",
        fillColor: "#f97316",
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
  }, [map, points]);

  return null;
}

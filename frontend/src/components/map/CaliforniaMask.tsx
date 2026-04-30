import { useEffect, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { useIsDark } from "../../context/ThemeContext";

const WORLD_RING: [number, number][] = [
  [-90, -180], [-90, 180], [90, 180], [90, -180], [-90, -180],
];

interface CaliforniaMaskProps {
  focusedCounty: string | null;
  compareCounty: string | null;
}

export default function CaliforniaMask({ focusedCounty, compareCounty }: CaliforniaMaskProps) {
  const map = useMap();
  const isDark = useIsDark();
  const layerRef = useRef<L.GeoJSON | null>(null);
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);

  useEffect(() => {
    fetch("/ca-counties.geojson")
      .then((res) => res.json())
      .then(setGeojson);
  }, []);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    if (!geojson) return;

    const activeCounties = new Set<string>();
    if (focusedCounty) activeCounties.add(focusedCounty);
    if (compareCounty) activeCounties.add(compareCounty);

    const holes: [number, number][][] = [];
    for (const feature of geojson.features) {
      const name = (feature.properties?.name ?? "").toString();
      if (activeCounties.size > 0 && !activeCounties.has(name)) continue;

      const geom = feature.geometry;
      if (geom.type === "Polygon") {
        holes.push(geom.coordinates[0] as [number, number][]);
      } else if (geom.type === "MultiPolygon") {
        for (const poly of geom.coordinates) {
          holes.push(poly[0] as [number, number][]);
        }
      }
    }

    const invertedPolygon: GeoJSON.Feature<GeoJSON.Polygon> = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          WORLD_RING.map(([lat, lng]) => [lng, lat]),
          ...holes,
        ],
      },
    };

    const fillColor = isDark ? "#1d1d1d" : "#e8e5e0";

    const layer = L.geoJSON(invertedPolygon, {
      style: {
        fillColor,
        fillOpacity: 0.95,
        stroke: false,
      },
      interactive: false,
    });

    layer.addTo(map);
    layerRef.current = layer;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, geojson, isDark, focusedCounty, compareCounty]);

  return null;
}

import { useEffect, useState, useCallback, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

interface CountyBoundariesProps {
  focusedCounty: string | null;
  onFocusCounty: (name: string | null) => void;
  onSelectCounty: (name: string) => void;
}

const DEFAULT_STYLE: L.PathOptions = {
  color: "#78716c",
  weight: 1,
  fillColor: "#78716c",
  fillOpacity: 0.03,
};

const FOCUSED_STYLE: L.PathOptions = {
  color: "#6750a4",
  weight: 3,
  fillColor: "#6750a4",
  fillOpacity: 0.12,
};

export default function CountyBoundaries({
  focusedCounty,
  onFocusCounty,
  onSelectCounty,
}: CountyBoundariesProps) {
  const map = useMap();
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const layerRef = useRef<L.GeoJSON | null>(null);
  const tooltipRef = useRef<L.Tooltip | null>(null);

  // Load GeoJSON on mount
  useEffect(() => {
    fetch("/ca-counties.geojson")
      .then((res) => res.json())
      .then((data: GeoJSON.FeatureCollection) => {
        data.features.sort((a, b) => {
          const nameA = a.properties?.name ?? "";
          const nameB = b.properties?.name ?? "";
          return nameA.localeCompare(nameB);
        });
        setGeojson(data);
      });
  }, []);

  const getCountyName = useCallback((feature: GeoJSON.Feature): string => {
    return (feature.properties?.name ?? "").toString();
  }, []);

  // Render GeoJSON layer
  useEffect(() => {
    if (!geojson) return;

    if (layerRef.current) {
      map.removeLayer(layerRef.current);
    }

    const layer = L.geoJSON(geojson, {
      style: (feature) => {
        if (!feature) return DEFAULT_STYLE;
        return getCountyName(feature) === focusedCounty ? FOCUSED_STYLE : DEFAULT_STYLE;
      },
      onEachFeature: (feature, featureLayer) => {
        const name = getCountyName(feature);
        featureLayer.on({
          click: () => {
            onFocusCounty(name);
            onSelectCounty(name);
          },
          mouseover: () => {
            if (name !== focusedCounty) {
              (featureLayer as L.Path).setStyle({ weight: 2, fillOpacity: 0.08 });
            }
          },
          mouseout: () => {
            if (name !== focusedCounty) {
              (featureLayer as L.Path).setStyle(DEFAULT_STYLE);
            }
          },
        });
      },
    });

    layer.addTo(map);
    layerRef.current = layer;

    return () => {
      map.removeLayer(layer);
    };
  }, [geojson, focusedCounty, map, getCountyName, onFocusCounty, onSelectCounty]);

  // Tooltip for focused county
  useEffect(() => {
    if (tooltipRef.current) {
      map.removeLayer(tooltipRef.current);
      tooltipRef.current = null;
    }

    if (!focusedCounty || !layerRef.current) return;

    layerRef.current.eachLayer((featureLayer) => {
      const feature = (featureLayer as L.GeoJSON & { feature: GeoJSON.Feature }).feature;
      if (feature && getCountyName(feature) === focusedCounty) {
        const bounds = (featureLayer as L.Polygon).getBounds();
        const center = bounds.getCenter();

        const tooltip = L.tooltip({
          permanent: true,
          direction: "center",
          className: "county-focus-tooltip",
        })
          .setLatLng(center)
          .setContent(focusedCounty)
          .addTo(map);

        tooltipRef.current = tooltip;

        if (!map.getBounds().contains(center)) {
          map.panTo(center, { animate: true });
        }
      }
    });

    return () => {
      if (tooltipRef.current) {
        map.removeLayer(tooltipRef.current);
        tooltipRef.current = null;
      }
    };
  }, [focusedCounty, map, getCountyName]);

  return null;
}

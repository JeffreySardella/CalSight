import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { useLayersState } from "../../hooks/useLayersState";
import { useChoroplethData } from "../../hooks/useChoroplethData";
import { useFilterParams } from "../../hooks/useFilterParams";
import { quantileBuckets, bucketFor } from "../../lib/choropleth/binning";
import { getPalette, HATCH_PATTERN_ID, installHatchPattern } from "../../lib/choropleth/palettes";
import { useIsDark } from "../../context/ThemeContext";

interface CountyBoundariesProps {
  focusedCounty: string | null;
  onFocusCounty: (name: string | null) => void;
  onSelectCounty: (name: string) => void;
}

const OUTLINE_ONLY_STYLE: L.PathOptions = {
  color: "#78716c",
  weight: 1,
  fillColor: "#78716c",
  fillOpacity: 0.03,
};

const FOCUSED_WEIGHT = 3;
const FOCUSED_COLOR = "#6750a4";

function getCountyName(f: GeoJSON.Feature): string {
  return (f.properties?.name ?? "").toString();
}

function getCountyCode(f: GeoJSON.Feature): number | null {
  const raw = f.properties?.county_code;
  return raw == null ? null : Number(raw);
}

export default function CountyBoundaries({
  focusedCounty,
  onFocusCounty,
  onSelectCounty,
}: CountyBoundariesProps) {
  const map = useMap();
  const { selectedYears, selectedSeverities, selectedCauses } = useFilterParams();
  const { choroplethOn, measure, palette, setBucketEdges, otherLayers } = useLayersState();
  const isDark = useIsDark();

  if (!otherLayers.countyBoundaries && !choroplethOn) {
    // If both are off, maybe we don't render. But wait, what if they toggle it back?
    // Let's just hide the layer.
  }

  const filters = useMemo(
    () => ({
      years: [...selectedYears].sort((a, b) => a - b),
      severities: [...selectedSeverities],
      causes: [...selectedCauses],
    }),
    [selectedYears, selectedSeverities, selectedCauses],
  );
  const { byCountyCode } = useChoroplethData(measure, filters);

  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const layerRef = useRef<L.GeoJSON | null>(null);
  const tooltipRef = useRef<L.Tooltip | null>(null);
  const edgesRef = useRef<number[] | null>(null);

  useEffect(() => {
    installHatchPattern();
  }, []);

  useEffect(() => {
    fetch("/ca-counties.geojson")
      .then((res) => res.json())
      .then((data: GeoJSON.FeatureCollection) => {
        data.features.sort((a, b) => getCountyName(a).localeCompare(getCountyName(b)));
        setGeojson(data);
      });
  }, []);

  const computeStyle = useCallback(
    (feature: GeoJSON.Feature): L.PathOptions => {
      const isFocused = getCountyName(feature) === focusedCounty;
      const outlineColor = isDark ? "#a3a3a3" : "#78716c";
      
      const showBorder = isFocused || otherLayers.countyBoundaries;
      const borderColor = isFocused ? FOCUSED_COLOR : (showBorder ? outlineColor : "transparent");
      const borderWeight = isFocused ? FOCUSED_WEIGHT : (showBorder ? 1 : 0);

      if (!choroplethOn) {
        if (!otherLayers.countyBoundaries && !isFocused) {
          return { stroke: false, fill: false };
        }
        const base: L.PathOptions = { ...OUTLINE_ONLY_STYLE, color: borderColor, weight: borderWeight, fillColor: outlineColor };
        return isFocused
          ? { ...base, fillOpacity: 0.12 }
          : base;
      }

      const code = getCountyCode(feature);
      const point = code != null ? byCountyCode[code] : undefined;
      const colors = getPalette(palette, isDark);

      if (!point || !point.hasEnoughData || point.value == null) {
        return {
          color: borderColor,
          weight: borderWeight,
          fillColor: `url(#${HATCH_PATTERN_ID})`,
          fillOpacity: 1,
        };
      }

      const edges = edgesRef.current;
      if (!edges) {
        return { color: borderColor, weight: borderWeight, fillColor: colors[0], fillOpacity: 0.6 };
      }
      const idx = bucketFor(point.value, edges);
      return {
        color: borderColor,
        weight: borderWeight,
        fillColor: colors[idx],
        fillOpacity: 0.75,
      };
    },
    [choroplethOn, otherLayers.countyBoundaries, focusedCounty, byCountyCode, palette, isDark],
  );

  const rebucketAndRepaint = useCallback(() => {
    const layer = layerRef.current;
    if (!layer || !geojson) return;

    if (!otherLayers.countyBoundaries && !choroplethOn) {
       // if both are disabled, we could just remove the layer or clear it
    }

    if (choroplethOn) {
      const viewBounds = map.getBounds();
      const visibleValues: number[] = [];
      layer.eachLayer((fl) => {
        const f = (fl as L.GeoJSON & { feature: GeoJSON.Feature }).feature;
        const code = getCountyCode(f);
        const point = code != null ? byCountyCode[code] : undefined;
        if (!point || !point.hasEnoughData || point.value == null) return;
        const lb = (fl as L.Polygon).getBounds?.();
        if (lb && viewBounds.intersects(lb)) visibleValues.push(point.value);
      });
      const edges = quantileBuckets(visibleValues, 5);
      if (edges) edgesRef.current = edges;
      setBucketEdges(edgesRef.current);
    }

    layer.eachLayer((fl) => {
      const f = (fl as L.GeoJSON & { feature: GeoJSON.Feature }).feature;
      const path = fl as L.Path;
      if (typeof path.setStyle === "function") {
        if (!otherLayers.countyBoundaries && !choroplethOn) {
          path.setStyle({ stroke: false, fill: false });
        } else {
          path.setStyle(computeStyle(f));
        }
      }
    });
  }, [map, geojson, choroplethOn, otherLayers.countyBoundaries, byCountyCode, computeStyle, setBucketEdges]);

  useEffect(() => {
    if (!geojson) return;
    if (layerRef.current) map.removeLayer(layerRef.current);

    try {
      const layer = L.geoJSON(geojson, {
        style: (feature) => computeStyle(feature ?? { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [] } }),
        onEachFeature: (feature, featureLayer) => {
          const name = getCountyName(feature);
          featureLayer.on({
            click: () => {
              onFocusCounty(name);
              onSelectCounty(name);
            },
            mouseover: (e) => {
              if (name !== focusedCounty) {
                const path = e.target as L.Path;
                path.setStyle({ weight: 2, color: FOCUSED_COLOR });
                if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
                  path.bringToFront();
                }
              }
            },
            mouseout: (e) => {
              if (name !== focusedCounty) {
                const layer = layerRef.current as L.GeoJSON | null;
                if (layer) {
                  layer.resetStyle(e.target);
                }
              }
            },
          });
        },
      });
      layer.addTo(map);
      layerRef.current = layer;
    } catch (e) {
      console.error("[CountyBoundaries] failed to render geojson layer", e);
    }

    return () => {
      if (layerRef.current) map.removeLayer(layerRef.current);
      layerRef.current = null;
    };
    // computeStyle identity would thrash event bindings; intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geojson, map]);

  useEffect(() => {
    rebucketAndRepaint();
  }, [rebucketAndRepaint]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onMoveEnd = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(rebucketAndRepaint, 200);
    };
    map.on("moveend", onMoveEnd);
    return () => {
      if (timer) clearTimeout(timer);
      map.off("moveend", onMoveEnd);
    };
  }, [map, rebucketAndRepaint]);

  useEffect(() => {
    if (tooltipRef.current) {
      map.removeLayer(tooltipRef.current);
      tooltipRef.current = null;
    }
    if (!focusedCounty || !layerRef.current) return;
    layerRef.current.eachLayer((fl) => {
      const f = (fl as L.GeoJSON & { feature: GeoJSON.Feature }).feature;
      if (f && getCountyName(f) === focusedCounty) {
        const bounds = (fl as L.Polygon).getBounds();
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
  }, [focusedCounty, map]);

  return null;
}

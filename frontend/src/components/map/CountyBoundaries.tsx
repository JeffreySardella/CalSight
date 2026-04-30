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
  compareCounty?: string | null;
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
  compareCounty = null,
  onFocusCounty,
  onSelectCounty,
}: CountyBoundariesProps) {
  const map = useMap();
  const { selectedYears, selectedSeverities, selectedCauses, selectedCounties } = useFilterParams();
  const { choroplethOn, measure, palette, setBucketEdges, otherLayers } = useLayersState();
  const isDark = useIsDark();

  // County filter: empty set = all counties selected (no filtering)
  const hasCountyFilter = selectedCounties.size > 0;

  // Note: `selectedCounties` is intentionally NOT passed into the stats
  // fetch — we always fetch ALL 58 counties so bucket edges stay globally
  // consistent. County filtering is applied visually in `computeStyle`.
  // NOTE: alcohol/distracted are also omitted — /api/stats rejects those
  // params (MVs don't carry them). See stats.py lines 134-143.
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
  const compareTooltipRef = useRef<L.Tooltip | null>(null);
  const edgesRef = useRef<number[] | null>(null);

  // Refs so event handlers (bound once) can read current callback/filter state
  const onFocusCountyRef = useRef(onFocusCounty);
  onFocusCountyRef.current = onFocusCounty;
  const onSelectCountyRef = useRef(onSelectCounty);
  onSelectCountyRef.current = onSelectCounty;

  const countyFilterRef = useRef<{ has: Set<string>; active: boolean }>({
    has: selectedCounties,
    active: hasCountyFilter,
  });
  countyFilterRef.current = { has: selectedCounties, active: hasCountyFilter };

  const focusRef = useRef<{ focused: string | null; compare: string | null }>({
    focused: focusedCounty,
    compare: compareCounty ?? null,
  });
  focusRef.current = { focused: focusedCounty, compare: compareCounty ?? null };



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
      const name = getCountyName(feature);
      const isFocused = name === focusedCounty || name === compareCounty;
      const outlineColor = isDark ? "#a3a3a3" : "#78716c";

      // When counties are filtered via the UI, unselected counties
      // keep normal outlines but get no choropleth fill — just a
      // neutral outline so they're still visible and clickable.
      const isInFilter = !hasCountyFilter || selectedCounties.has(name);

      if (!isInFilter && !isFocused) {
        return {
          ...OUTLINE_ONLY_STYLE,
          color: isDark ? "#555" : "#78716c",
          fillColor: isDark ? "#555" : "#78716c",
        };
      }

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

      if (otherLayers.heatmapStatewide || otherLayers.heatmapCounty) {
        return {
          color: borderColor,
          weight: borderWeight,
          fillOpacity: 0,
        };
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
    [choroplethOn, otherLayers.countyBoundaries, otherLayers.heatmapStatewide, otherLayers.heatmapCounty, focusedCounty, compareCounty, hasCountyFilter, selectedCounties, byCountyCode, palette, isDark],
  );

  // Ref so mouseout can re-apply the *current* style (not the stale one
  // captured at layer creation time that Leaflet's resetStyle would use).
  const computeStyleRef = useRef(computeStyle);
  computeStyleRef.current = computeStyle;

  const rebucketAndRepaint = useCallback(() => {
    const layer = layerRef.current;
    if (!layer || !geojson) return;

    if (choroplethOn) {
      // Compute bucket edges across ALL counties with data — not filtered
      // by viewport. This keeps the color scale globally consistent,
      // especially important when only a handful of counties are selected.
      const allValues: number[] = [];
      layer.eachLayer((fl) => {
        const f = (fl as L.GeoJSON & { feature: GeoJSON.Feature }).feature;
        const code = getCountyCode(f);
        const point = code != null ? byCountyCode[code] : undefined;
        if (!point || !point.hasEnoughData || point.value == null) return;
        allValues.push(point.value);
      });
      const edges = quantileBuckets(allValues, 5);
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
  }, [geojson, choroplethOn, otherLayers.countyBoundaries, byCountyCode, computeStyle, setBucketEdges]);

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
              onFocusCountyRef.current(name);
              onSelectCountyRef.current(name);
            },
            mouseover: (e) => {
              if (name === focusedCounty) return;
              const cf = countyFilterRef.current;
              if (cf.active && !cf.has.has(name)) return;
              const fc = focusRef.current;
              if (fc.focused && name !== fc.focused && name !== fc.compare) return;

              const path = e.target as L.Path;
              path.setStyle({ weight: 2, color: FOCUSED_COLOR });
              if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
                path.bringToFront();
              }
            },
            mouseout: (e) => {
              if (name === focusedCounty) return;
              const cf = countyFilterRef.current;
              if (cf.active && !cf.has.has(name)) return;

              // Don't use layer.resetStyle() — it calls the stale style
              // function from layer creation, wiping choropleth colors.
              const path = e.target as L.Path;
              path.setStyle(computeStyleRef.current(feature));
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
    const handleMapClick = (e: L.LeafletMouseEvent) => {
      const target = e.originalEvent?.target as HTMLElement | undefined;
      if (target?.closest?.(".leaflet-interactive")) return;
      onFocusCounty(null);
    };
    map.on("click", handleMapClick);
    return () => {
      map.off("click", handleMapClick);
    };
  }, [map, onFocusCounty]);

  useEffect(() => {
    if (tooltipRef.current) {
      map.removeLayer(tooltipRef.current);
      tooltipRef.current = null;
    }
    if (compareTooltipRef.current) {
      map.removeLayer(compareTooltipRef.current);
      compareTooltipRef.current = null;
    }

    if (!layerRef.current) return;

    const showTooltipFor = (name: string, ref: React.MutableRefObject<L.Tooltip | null>) => {
      layerRef.current!.eachLayer((fl) => {
        const f = (fl as L.GeoJSON & { feature: GeoJSON.Feature }).feature;
        if (f && getCountyName(f) === name) {
          const bounds = (fl as L.Polygon).getBounds();
          const center = bounds.getCenter();
          const tooltip = L.tooltip({
            permanent: true,
            direction: "center",
            className: "county-focus-tooltip",
          })
            .setLatLng(center)
            .setContent(name)
            .addTo(map);
          ref.current = tooltip;
          if (!map.getBounds().contains(center)) {
            map.panTo(center, { animate: true });
          }
        }
      });
    };

    if (focusedCounty) showTooltipFor(focusedCounty, tooltipRef);
    if (compareCounty) showTooltipFor(compareCounty, compareTooltipRef);

    return () => {
      if (tooltipRef.current) {
        map.removeLayer(tooltipRef.current);
        tooltipRef.current = null;
      }
      if (compareTooltipRef.current) {
        map.removeLayer(compareTooltipRef.current);
        compareTooltipRef.current = null;
      }
    };
  }, [focusedCounty, compareCounty, map]);

  return null;
}

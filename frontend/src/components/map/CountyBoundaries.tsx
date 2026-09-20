import { memo, useEffect, useMemo, useCallback, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { useLayersState } from "../../hooks/useLayersState";
import { useChoroplethData } from "../../hooks/useChoroplethData";
import { useFilterParams } from "../../hooks/useFilterParams";
import { useCountyGeoJson } from "../../hooks/useCountyGeoJson";
import { legendEdges, bucketFor } from "../../lib/choropleth/binning";
import { MEASURES } from "../../lib/choropleth/measures";
import { getPalette, HATCH_PATTERN_ID, installHatchPattern } from "../../lib/choropleth/palettes";
import { prefersReducedMotionNow } from "../../lib/a11y/motion";
import { useIsDark } from "../../context/ThemeContext";
import { useIsMobile } from "../../hooks/useIsMobile";

interface CountyBoundariesProps {
  focusedCounty: string | null;
  compareCounty?: string | null;
  heatmapActive?: boolean;
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

/** Phone/narrow-tablet widths, where a finger lands on a whole county. */
const TOUCH_MAX_WIDTH = 768;
/** How far a tap zooms in on touch. Two steps: one felt like nothing happened. */
const TAP_ZOOM_STEPS = 2;

function getCountyName(f: GeoJSON.Feature): string {
  return (f.properties?.name ?? "").toString();
}

function getCountyCode(f: GeoJSON.Feature): number | null {
  const raw = f.properties?.county_code;
  return raw == null ? null : Number(raw);
}

export default memo(function CountyBoundaries({
  focusedCounty,
  compareCounty = null,
  heatmapActive = false,
  onFocusCounty,
  onSelectCounty,
}: CountyBoundariesProps) {
  const map = useMap();
  const { selectedDateRange, selectedSeverities, selectedCauses, selectedCounties, selectedAlcohol, selectedDistracted, selectedPedestrian, selectedCyclist, selectedDrug, selectedDriverAge, selectedWeather, selectedLighting, selectedCollisionType, selectedRoadType, selectedHitRun } = useFilterParams();
  const { choroplethOn, measure, palette, setBucketEdges, otherLayers } = useLayersState();
  const isDark = useIsDark();

  // County filter: empty set = all counties selected (no filtering)
  const hasCountyFilter = selectedCounties.size > 0;

  const filters = useMemo(
    () => ({
      dateRange: selectedDateRange,
      severities: [...selectedSeverities],
      causes: [...selectedCauses],
      alcohol: selectedAlcohol ?? undefined,
      distracted: selectedDistracted ?? undefined,
      pedestrian: selectedPedestrian ?? undefined,
      cyclist: selectedCyclist ?? undefined,
      drug: selectedDrug ?? undefined,
      driverAge: selectedDriverAge ?? undefined,
      weather: selectedWeather.size ? [...selectedWeather] : undefined,
      lighting: selectedLighting.size ? [...selectedLighting] : undefined,
      collisionType: selectedCollisionType.size ? [...selectedCollisionType] : undefined,
      roadType: selectedRoadType ?? undefined,
      hitRun: selectedHitRun ?? undefined,
    }),
    [selectedDateRange, selectedSeverities, selectedCauses, selectedAlcohol, selectedDistracted, selectedPedestrian, selectedCyclist, selectedDrug, selectedDriverAge, selectedWeather, selectedLighting, selectedCollisionType, selectedRoadType, selectedHitRun],
  );
  const { byCountyCode } = useChoroplethData(measure, filters);

  const { data: geojson } = useCountyGeoJson();
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

  // Touch tap-to-zoom (see tapZoom below). Read through a ref because the
  // per-feature click handlers are bound once, at layer creation.
  const isTouchWidth = useIsMobile(TOUCH_MAX_WIDTH);
  const tapZoomRef = useRef<(latlng: L.LatLng) => boolean>(() => false);
  /**
   * On a phone the heat canvas has pointer-events: none, so a tap aimed at a
   * hotspot falls straight through to whichever county polygon is underneath —
   * and at zoom 7 most of the screen around a hotspot is *neighbouring*
   * counties. Selecting one swaps the filter, opens the insight card, refires
   * every query and fitBounds the camera somewhere else: a destructive answer
   * to "I want a closer look at that red blob".
   *
   * So while a heat layer is on at touch widths, a tap zooms toward the point
   * instead. County selection stays reachable through the search bar and the
   * filter sheet's county list (the focused-county label only deselects). Desktop (where a
   * mouse click is precise and hover previews the county) is untouched, as is
   * the no-heatmap case.
   */
  tapZoomRef.current = (latlng: L.LatLng) => {
    if (!heatmapActive || !isTouchWidth) return false;
    const current = map.getZoom();
    const target = Math.min(current + TAP_ZOOM_STEPS, map.getMaxZoom());
    // Already as deep as the data goes — fall through to normal selection
    // rather than swallowing the tap and doing nothing at all.
    if (target <= current) return false;
    map.setView(latlng, target, { animate: !prefersReducedMotionNow() });
    return true;
  };



  useEffect(() => {
    installHatchPattern();
    if (!map.getPane("countyPane")) {
      const pane = map.createPane("countyPane");
      pane.style.zIndex = "450";
    }
  }, [map]);

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

      if (heatmapActive && focusedCounty) {
        return {
          color: borderColor,
          weight: borderWeight,
          fillOpacity: 0,
        };
      }

      const code = getCountyCode(feature);
      const point = code != null ? byCountyCode[code] : undefined;
      const colors = getPalette(palette, isDark);

      // Highway Danger draws colored route lines over the choropleth — dim the
      // county fill so those lines stay readable. Hover/selected (isFocused)
      // styling above is untouched since it returns before reaching here.
      const dimFactor = otherLayers.highwayDanger ? 0.4 : 1;

      if (!point || !point.hasEnoughData || point.value == null) {
        return {
          color: borderColor,
          weight: borderWeight,
          fillColor: `url(#${HATCH_PATTERN_ID})`,
          fillOpacity: 1 * dimFactor,
        };
      }

      const edges = edgesRef.current;
      if (!edges) {
        return { color: borderColor, weight: borderWeight, fillColor: colors[0], fillOpacity: 0.6 * dimFactor };
      }
      const idx = bucketFor(point.value, edges);
      return {
        color: borderColor,
        weight: borderWeight,
        fillColor: colors[idx],
        fillOpacity: 0.75 * dimFactor,
      };
    },
    [choroplethOn, otherLayers.countyBoundaries, otherLayers.heatmapStatewide, otherLayers.highwayDanger, heatmapActive, focusedCounty, compareCounty, hasCountyFilter, selectedCounties, byCountyCode, palette, isDark],
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
      // legendEdges never freezes a stale array from a previous, larger
      // selection: with too few values for real quantiles it collapses to a
      // single class spanning the current data, and integer measures (raw
      // counts) round to whole-number breaks.
      const edges = legendEdges(allValues, 5, { integer: MEASURES[measure]?.kind === "raw" });
      edgesRef.current = edges;
      setBucketEdges(edges);
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
  }, [geojson, choroplethOn, otherLayers.countyBoundaries, byCountyCode, measure, computeStyle, setBucketEdges]);

  useEffect(() => {
    if (!geojson) return;
    if (layerRef.current) map.removeLayer(layerRef.current);

    try {
      const layer = L.geoJSON(geojson, {
        pane: "countyPane",
        style: (feature) => computeStyle(feature ?? { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [] } }),
        onEachFeature: (feature, featureLayer) => {
          const name = getCountyName(feature);
          featureLayer.on({
            click: (e: L.LeafletMouseEvent) => {
              if (tapZoomRef.current(e.latlng)) return;
              onFocusCountyRef.current(name);
              onSelectCountyRef.current(name);
            },
            mouseover: (e) => {
              if (name === focusRef.current.focused) return;
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
              if (name === focusRef.current.focused) return;
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

  // Recompute breaks and repaint only when something that affects them
  // changes — the measure, the choropleth data, the palette, the focus.
  // There used to be a second, moveend-debounced call to the same function,
  // but nothing it does depends on the viewport: legendEdges deliberately runs
  // over ALL counties with data (see rebucketAndRepaint) and computeStyle never
  // reads the bounds. Every pan therefore paid for a quantile pass plus 58
  // setStyle calls to arrive at the styles already on screen — a third of the
  // per-pan cost behind the "barely moving around was a pain" report.
  useEffect(() => {
    rebucketAndRepaint();
  }, [rebucketAndRepaint]);

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

    let combined: L.LatLngBounds | null = null;

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
          combined = combined ? combined.extend(bounds) : bounds;
        }
      });
    };

    if (focusedCounty) showTooltipFor(focusedCounty, tooltipRef);
    if (compareCounty) showTooltipFor(compareCounty, compareTooltipRef);

    if (combined) {
      // No animated zoom under reduced motion — jump straight to the bounds.
      map.fitBounds(combined, {
        animate: !prefersReducedMotionNow(),
        padding: [40, 40],
        maxZoom: 11,
      });
    }

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
});

import { memo, useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { useHighwayGeoJson } from "../../hooks/useHighwayGeoJson";
import { useHighwayRankings, type HighwayRow } from "../../hooks/useHighwayRankings";
import { useLayersState } from "../../hooks/useLayersState";
import { useFilterParams } from "../../hooks/useFilterParams";
import { buildDangerFeatures } from "../../lib/map/highwayDanger";
import type { StatsFilters } from "../../hooks/useStats";

const NO_DATA_COLOR = "#9ca3af";
const HIGHWAY_LIMIT = 300;

// Dedicated "danger" ramp for highway lines, independent of the county
// choropleth palette. Reusing the choropleth palette made highways the same
// blue as the counties underneath, so they vanished into the shading. This
// mono-danger ramp (light orange -> crimson, low..high) reads on top of any
// choropleth in either theme and never implies a road is "safe".
const HIGHWAY_DANGER_COLORS = ["#fdba74", "#f97316", "#dc2626", "#7f1d1d"] as const;

// A white halo drawn UNDER each colored line. The danger colors (esp. the dark
// crimson high end) muddied into the blue choropleth without it; the casing
// makes every route read as a distinct line on any background / theme.
const CASING_COLOR = "#ffffff";

// Dedicated Leaflet pane so highways draw above the county choropleth.
const HIGHWAY_PANE = "highwayDangerPane";

interface HighwayDangerLayerProps {
  onSelectHighway: (row: HighwayRow) => void;
  /** Route whose side panel is currently open. When the rankings refetch
   * (filter change), the layer pushes that route's fresh row back through
   * onSelectHighway so the panel never shows numbers from stale filters. */
  selectedRoute?: string | null;
  /** Called when the selected route has no row under the new filters
   * (fell out of the ranking) — the panel should close rather than lie. */
  onSelectedRouteGone?: () => void;
}

/**
 * Draws California highways as lines colored by crash danger.
 *
 * Geometry comes from the static ca-highways.geojson; the danger value per
 * route comes from /api/stats/highways (respecting the active map filters).
 * The two are joined by route_number into colored "danger features"
 * (see lib/map/highwayDanger). Renders nothing when the layer is toggled off.
 *
 * Imperative Leaflet layer management mirrors CountyBoundaries.
 */
export default memo(function HighwayDangerLayer({ onSelectHighway, selectedRoute, onSelectedRouteGone }: HighwayDangerLayerProps) {
  const map = useMap();
  const fp = useFilterParams();
  const { otherLayers, highwayMetric } = useLayersState();
  const enabled = otherLayers.highwayDanger;

  const { data: geo } = useHighwayGeoJson();

  const filters = useMemo<StatsFilters>(
    () => ({
      dateRange: fp.selectedDateRange,
      severities: [...fp.selectedSeverities],
      causes: [...fp.selectedCauses],
      counties: [...fp.selectedCounties].map((c) => c.toLowerCase().replace(/ /g, "-")),
      alcohol: fp.selectedAlcohol,
      pedestrian: fp.selectedPedestrian,
      cyclist: fp.selectedCyclist,
      drug: fp.selectedDrug,
      distracted: fp.selectedDistracted,
      driverAge: fp.selectedDriverAge,
      weather: fp.selectedWeather.size > 0 ? [...fp.selectedWeather].join(",") : null,
      lighting: fp.selectedLighting.size > 0 ? [...fp.selectedLighting].join(",") : null,
      collisionType: fp.selectedCollisionType.size > 0 ? [...fp.selectedCollisionType].join(",") : null,
      roadType: fp.selectedRoadType,
      hitRun: fp.selectedHitRun,
    }),
    [
      fp.selectedDateRange, fp.selectedSeverities, fp.selectedCauses, fp.selectedCounties,
      fp.selectedAlcohol, fp.selectedPedestrian, fp.selectedCyclist, fp.selectedDrug,
      fp.selectedDistracted, fp.selectedDriverAge, fp.selectedWeather, fp.selectedLighting,
      fp.selectedCollisionType, fp.selectedRoadType, fp.selectedHitRun,
    ],
  );

  // Only fetch danger data when the layer is on.
  const { data: rows } = useHighwayRankings(filters, highwayMetric, HIGHWAY_LIMIT, enabled);

  const onSelectRef = useRef(onSelectHighway);
  onSelectRef.current = onSelectHighway;
  const onGoneRef = useRef(onSelectedRouteGone);
  onGoneRef.current = onSelectedRouteGone;

  // M-F5: keep the open side panel in sync with the active filters. rows is
  // react-query data (stable identity), so this only fires on a real refetch;
  // re-selecting the same row object is a no-op setState upstream.
  useEffect(() => {
    if (!selectedRoute || !rows) return;
    const fresh = rows.find((r) => r.route_number === selectedRoute);
    if (fresh) onSelectRef.current(fresh);
    else onGoneRef.current?.();
  }, [rows, selectedRoute]);

  const layerRef = useRef<L.Layer | null>(null);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    if (!enabled || !geo) return;

    // Render highways in a dedicated pane ABOVE the county choropleth. Leaflet's
    // default overlayPane (z-index 400) holds the choropleth, which is a
    // semi-transparent fill — when highways shared that pane the blue washed
    // over them and muddied the danger colors. A pane at 450 keeps highways on
    // top of the choropleth but still below markers (600) / popups (700).
    if (!map.getPane(HIGHWAY_PANE)) {
      map.createPane(HIGHWAY_PANE);
      const pane = map.getPane(HIGHWAY_PANE);
      if (pane) pane.style.zIndex = "450";
    }

    const features = buildDangerFeatures(geo, rows ?? [], highwayMetric, HIGHWAY_DANGER_COLORS, NO_DATA_COLOR);
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: features.map((f) => ({
        type: "Feature",
        properties: { route_number: f.route_number, color: f.color, row: f.row },
        geometry: f.geometry,
      })),
    };

    try {
      // White casing underneath (non-interactive) so the colored lines pop.
      const casing = L.geoJSON(fc, {
        pane: HIGHWAY_PANE,
        interactive: false,
        style: () => ({ color: CASING_COLOR, weight: 8, opacity: 0.9 }),
      });
      // Colored danger lines on top; these carry the click handler.
      const lines = L.geoJSON(fc, {
        pane: HIGHWAY_PANE,
        style: (feature) => ({
          color: (feature?.properties?.color as string) ?? NO_DATA_COLOR,
          weight: 5,
          opacity: 1,
        }),
        onEachFeature: (feature, featureLayer) => {
          const row = (feature.properties?.row ?? null) as HighwayRow | null;
          featureLayer.on({
            click: () => {
              if (row) onSelectRef.current(row);
            },
          });
        },
      });
      const group = L.layerGroup([casing, lines]);
      group.addTo(map);
      layerRef.current = group;
    } catch (e) {
      console.error("[HighwayDangerLayer] failed to render geojson layer", e);
    }

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, enabled, geo, rows, highwayMetric]);

  return null;
});

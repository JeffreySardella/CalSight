import { memo, useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { useHighwayGeoJson } from "../../hooks/useHighwayGeoJson";
import { useHighwayRankings, type HighwayRow } from "../../hooks/useHighwayRankings";
import { useLayersState } from "../../hooks/useLayersState";
import { useFilterParams } from "../../hooks/useFilterParams";
import { getPalette } from "../../lib/choropleth/palettes";
import { useIsDark } from "../../context/ThemeContext";
import { buildDangerFeatures } from "../../lib/map/highwayDanger";
import type { StatsFilters } from "../../hooks/useStats";

const NO_DATA_COLOR = "#9ca3af";
const HIGHWAY_LIMIT = 300;

interface HighwayDangerLayerProps {
  onSelectHighway: (row: HighwayRow) => void;
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
export default memo(function HighwayDangerLayer({ onSelectHighway }: HighwayDangerLayerProps) {
  const map = useMap();
  const fp = useFilterParams();
  const { otherLayers, palette, highwayMetric } = useLayersState();
  const isDark = useIsDark();
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

  const layerRef = useRef<L.GeoJSON | null>(null);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    if (!enabled || !geo) return;

    const colors = getPalette(palette, isDark);
    const features = buildDangerFeatures(geo, rows ?? [], highwayMetric, colors, NO_DATA_COLOR);
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: features.map((f) => ({
        type: "Feature",
        properties: { route_number: f.route_number, color: f.color, row: f.row },
        geometry: f.geometry,
      })),
    };

    try {
      const layer = L.geoJSON(fc, {
        style: (feature) => ({
          color: (feature?.properties?.color as string) ?? NO_DATA_COLOR,
          weight: 4,
          opacity: 0.85,
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
      layer.addTo(map);
      layerRef.current = layer;
    } catch (e) {
      console.error("[HighwayDangerLayer] failed to render geojson layer", e);
    }

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, enabled, geo, rows, palette, isDark, highwayMetric]);

  return null;
});

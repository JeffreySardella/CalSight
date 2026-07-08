import { memo, useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { useLayersState } from "../../hooks/useLayersState";
import { useFilterParams } from "../../hooks/useFilterParams";
import { useClusterHotspots, type ClusterPoint } from "../../hooks/useClusterHotspots";

// Dedicated pane so cluster markers draw above the crash dot layer (625) but
// below the label tiles (650) / popups (700).
const CLUSTER_PANE = "clusterPane";

const MARKER_COLOR = "#b91c1c";
const MARKER_FILL = "#ef4444";
const MIN_RADIUS = 8;
const MAX_RADIUS = 16;
const MAX_Z_SCORE_FOR_SCALE = 6;

interface ClusterLayerProps {
  onSelectCluster: (cluster: ClusterPoint) => void;
}

function radiusFor(zScore: number): number {
  const frac = Math.max(0, Math.min(1, zScore / MAX_Z_SCORE_FOR_SCALE));
  return MIN_RADIUS + frac * (MAX_RADIUS - MIN_RADIUS);
}

/**
 * Plots statistically significant crash hotspots (grid density + z-score > 2σ,
 * see /api/crashes/clusters) as pulsing circle markers. Clicking a marker
 * hands the cluster's stats up to the side panel via onSelectCluster.
 * Renders nothing when the layer is toggled off. Imperative Leaflet layer
 * management mirrors TopIntersectionsLayer / HighwayDangerLayer.
 */
export default memo(function ClusterLayer({ onSelectCluster }: ClusterLayerProps) {
  const map = useMap();
  const fp = useFilterParams();
  const { otherLayers } = useLayersState();
  const enabled = otherLayers.crashClusters;

  const { clusters } = useClusterHotspots({
    enabled,
    county: fp.selectedCounties.size > 0
      ? [...fp.selectedCounties].map((c) => c.toLowerCase().replace(/ /g, "-")).join(",")
      : null,
    dateRange: fp.selectedDateRange,
    severities: [...fp.selectedSeverities],
    causes: [...fp.selectedCauses],
    // Coerce the default `false` (toggle off) to undefined so buildUrl omits
    // the param entirely. Sending `alcohol=false` makes the backend apply an
    // `IS FALSE` predicate, which silently drops pre-2016 SWITRS rows (flag is
    // NULL) and every flag-positive crash — corrupting the default hotspot set.
    // Mirrors MapPage's involvementFilters.
    alcohol: fp.selectedAlcohol || undefined,
    distracted: fp.selectedDistracted || undefined,
    pedestrian: fp.selectedPedestrian || undefined,
    cyclist: fp.selectedCyclist || undefined,
    drug: fp.selectedDrug || undefined,
    driverAge: fp.selectedDriverAge,
    weather: [...fp.selectedWeather],
    lighting: [...fp.selectedLighting],
    collisionType: [...fp.selectedCollisionType],
    roadType: fp.selectedRoadType,
    hitRun: fp.selectedHitRun,
  });

  const onSelectRef = useRef(onSelectCluster);
  onSelectRef.current = onSelectCluster;

  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    if (!enabled || clusters.length === 0) return;

    if (!map.getPane(CLUSTER_PANE)) {
      map.createPane(CLUSTER_PANE);
      const pane = map.getPane(CLUSTER_PANE);
      if (pane) pane.style.zIndex = "640";
    }

    const markers = clusters.map((cluster) => {
      const marker = L.circleMarker([cluster.lat, cluster.lng], {
        radius: radiusFor(cluster.z_score),
        color: MARKER_COLOR,
        fillColor: MARKER_FILL,
        fillOpacity: 0.55,
        weight: 2,
        pane: CLUSTER_PANE,
        className: "cluster-pulse-marker",
      });
      marker.on("click", () => onSelectRef.current(cluster));
      return marker;
    });

    const group = L.layerGroup(markers);
    group.addTo(map);
    layerRef.current = group;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, enabled, clusters]);

  return null;
});

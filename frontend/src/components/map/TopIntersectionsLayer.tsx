import { memo, useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { useLayersState } from "../../hooks/useLayersState";
import { useStreetAggregation, type StreetAggRow } from "../../hooks/useIntersections";

// How many top intersections to request / plot.
const TOP_LIMIT = 50;

// Dedicated pane so the markers draw above highway lines (450) but below the
// label tiles (650) / popups (700).
const TOP_INTERSECTIONS_PANE = "topIntersectionsPane";

// Neutral single-hue marker styling — the color carries no "safe/dangerous"
// meaning; rank is conveyed only by subtle size scaling.
const MARKER_COLOR = "#b45309";
const MARKER_FILL = "#f59e0b";
const MIN_RADIUS = 5;
const MAX_RADIUS = 11;

interface TopIntersectionsLayerProps {
  /** County slug to scope the ranking to (e.g. "los-angeles"). Null = statewide. */
  county: string | null;
}

/** Escape user-facing text before interpolating into the popup HTML string. */
function esc(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Subtle radius scaling by severity, so higher-ranked points read slightly larger. */
function radiusFor(row: StreetAggRow, maxSeverity: number): number {
  if (maxSeverity <= 0) return MIN_RADIUS;
  const frac = Math.max(0, Math.min(1, row.severity_score / maxSeverity));
  return MIN_RADIUS + frac * (MAX_RADIUS - MIN_RADIUS);
}

function popupHtml(row: StreetAggRow): string {
  const roads = row.secondary_road
    ? `${esc(row.primary_road)} & ${esc(row.secondary_road)}`
    : esc(row.primary_road);
  return [
    `<div class="text-xs leading-snug">`,
    `<div class="font-semibold mb-1">${roads}</div>`,
    `<div>Crashes: ${row.crash_count.toLocaleString()}</div>`,
    `<div>Fatal ${row.fatal_count} / Injury ${row.injury_count} / PDO ${row.pdo_count}</div>`,
    `<div>Severity score: ${row.severity_score.toLocaleString()}</div>`,
    `</div>`,
  ].join("");
}

/**
 * Plots the severity-ranked top intersections as circle markers, so the
 * street-level concentration shown in the Stats-page panel is also visible on
 * the map. Data comes from /api/intersections (sorted by severity); rows
 * without coordinates are skipped. Renders nothing when the layer is toggled
 * off. Imperative Leaflet layer management mirrors CoordMismatchLayer /
 * HighwayDangerLayer.
 */
export default memo(function TopIntersectionsLayer({ county }: TopIntersectionsLayerProps) {
  const map = useMap();
  const { otherLayers } = useLayersState();
  const enabled = otherLayers.topIntersections;

  const { data: rows } = useStreetAggregation({
    scope: "intersections",
    sort: "severity",
    county,
    limit: TOP_LIMIT,
    enabled,
  });

  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    if (!enabled || !rows || rows.length === 0) return;

    if (!map.getPane(TOP_INTERSECTIONS_PANE)) {
      map.createPane(TOP_INTERSECTIONS_PANE);
      const pane = map.getPane(TOP_INTERSECTIONS_PANE);
      if (pane) pane.style.zIndex = "630";
    }

    // Skip rows without coordinates — they can't be placed on the map.
    const placeable = rows.filter((r) => r.latitude != null && r.longitude != null);
    if (placeable.length === 0) return;

    const maxSeverity = placeable.reduce((m, r) => Math.max(m, r.severity_score), 0);

    const markers = placeable.map((row) => {
      const marker = L.circleMarker([row.latitude as number, row.longitude as number], {
        radius: radiusFor(row, maxSeverity),
        color: MARKER_COLOR,
        fillColor: MARKER_FILL,
        fillOpacity: 0.85,
        weight: 2,
        pane: TOP_INTERSECTIONS_PANE,
      });
      marker.bindPopup(popupHtml(row));
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
  }, [map, enabled, rows]);

  return null;
});

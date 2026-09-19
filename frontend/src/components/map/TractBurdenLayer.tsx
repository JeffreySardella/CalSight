import { memo, useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { useLayersState } from "../../hooks/useLayersState";
import { useFilterParams } from "../../hooks/useFilterParams";
import {
  burdenValue,
  useTractBurden,
  useTractGeoJson,
  CES_TOP_QUARTILE,
  type TractBurdenRow,
} from "../../hooks/useTractBurden";
import { quantileBuckets, bucketFor } from "../../lib/choropleth/binning";
import { getPalette } from "../../lib/choropleth/palettes";
import { useIsDark } from "../../context/ThemeContext";

const TRACT_PANE = "tractBurdenPane";

/** Outline colour for tracts in the most-burdened CES quartile. */
const CES_HIGHLIGHT = "#f59e0b";

function tooltipHtml(
  row: TractBurdenRow | undefined,
  geoid: string,
  populationAvailable: boolean,
): string {
  if (!row) return `Tract ${geoid}<br/>no data`;
  // No ordinal suffix: "3th"/"21th" is the classic naive-suffix bug, and the
  // rule costs more than the word "percentile".
  const ces =
    row.ces_percentile == null
      ? "no CES score"
      : `CES percentile ${Math.round(row.ces_percentile)}`;
  const burden =
    populationAvailable && row.crashes_per_1k_pop != null
      ? `${row.crashes_per_1k_pop.toLocaleString()} per 1,000 residents`
      : `${row.crash_count.toLocaleString()} crashes`;
  return (
    `<strong>Tract ${geoid}</strong><br/>${burden}<br/>` +
    `${row.killed.toLocaleString()} killed · ${row.injured.toLocaleString()} injured<br/>` +
    `<span style="opacity:.7">${ces} · mapped crashes only</span>`
  );
}

/**
 * Opt-in census-tract layer: crash burden (from crashes that have
 * coordinates) shaded against the CalEnviroScreen environmental-justice
 * score.
 *
 * Colour: a plain sequential quintile ramp on burden, reusing the county
 * choropleth's palette and binning, with an amber outline on tracts in the
 * top CES quartile. A 2x2 bivariate scheme was the alternative; it needs a
 * new palette, a new legend geometry and its own colour-blindness story, and
 * the one thing this layer has to communicate clearly — "burdened
 * communities are outlined; darker means more crashes there" — a sequential
 * ramp plus an outline already says.
 *
 * Both the boundary file and the aggregate are fetched only while the toggle
 * is on (1.4 MB of TopoJSON is not something to pull on first paint).
 *
 * The caveat this layer cannot omit lives in TractBurdenLegend: it covers
 * only crashes with coordinates, and it is an association, not a cause.
 */
export default memo(function TractBurdenLayer() {
  const map = useMap();
  const isDark = useIsDark();
  const { otherLayers, palette } = useLayersState();
  const { selectedDateRange } = useFilterParams();
  const enabled = otherLayers.tractBurden;

  const { data: geojson } = useTractGeoJson(enabled);
  const { data: burden } = useTractBurden(selectedDateRange, enabled);

  const layerRef = useRef<L.GeoJSON | null>(null);

  const byGeoid = useMemo(() => {
    const out: Record<string, TractBurdenRow> = {};
    for (const row of burden?.tracts ?? []) out[row.geoid] = row;
    return out;
  }, [burden]);

  const populationAvailable = burden?.summary.population_available ?? false;

  const edges = useMemo(() => {
    const values: number[] = [];
    for (const row of burden?.tracts ?? []) {
      const v = burdenValue(row, populationAvailable);
      if (v != null && v > 0) values.push(v);
    }
    return quantileBuckets(values, 5);
  }, [burden, populationAvailable]);

  useEffect(() => {
    if (!map.getPane(TRACT_PANE)) {
      const pane = map.createPane(TRACT_PANE);
      // Above countyPane (450). Below it, the county polygons win DOM hit
      // testing and the per-tract tooltip never fires — the tract detail is
      // the reason to turn this layer on, so it takes the hover.
      // ponytail: while the layer is on it also takes county clicks, so
      // click-to-drill-down pauses. Fix if that bites: drop `interactive`
      // here and drive one map-level tooltip off a point-in-polygon lookup.
      pane.style.zIndex = "460";
    }
  }, [map]);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    if (!enabled || !geojson || !burden) return;

    const colors = getPalette(palette, isDark);
    // 9,109 polygons as individual SVG paths stalls the main thread on pan;
    // canvas draws them in one pass and still dispatches mouse events. It
    // rides on PathOptions because L.geoJSON's own options don't take one.
    const renderer = L.canvas({ pane: TRACT_PANE });

    try {
      const layer = L.geoJSON(geojson, {
        pane: TRACT_PANE,
        style: (f) => {
          const geoid = String(f?.id ?? "");
          const row = byGeoid[geoid];
          const value = row ? burdenValue(row, populationAvailable) : null;
          const burdened =
            row?.ces_percentile != null && row.ces_percentile >= CES_TOP_QUARTILE;
          const base: L.PathOptions = {
            renderer,
            color: burdened ? CES_HIGHLIGHT : "transparent",
            weight: burdened ? 1 : 0,
            fillOpacity: 0.65,
          };
          if (value == null || value <= 0 || !edges) {
            return { ...base, fillOpacity: value == null ? 0 : 0.2, fillColor: colors[0] };
          }
          return { ...base, fillColor: colors[bucketFor(value, edges)] };
        },
        onEachFeature: (f, featureLayer) => {
          const geoid = String(f?.id ?? "");
          featureLayer.bindTooltip(
            tooltipHtml(byGeoid[geoid], geoid, populationAvailable),
            { sticky: true, className: "tract-burden-tooltip" },
          );
        },
      });
      layer.addTo(map);
      layerRef.current = layer;
    } catch (e) {
      console.error("[TractBurdenLayer] failed to render geojson layer", e);
    }

    return () => {
      if (layerRef.current) map.removeLayer(layerRef.current);
      layerRef.current = null;
    };
  }, [map, enabled, geojson, burden, byGeoid, edges, palette, isDark, populationAvailable]);

  return null;
});

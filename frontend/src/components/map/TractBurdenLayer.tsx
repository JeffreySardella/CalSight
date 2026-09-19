import { memo, useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { useLayersState } from "../../hooks/useLayersState";
import { useFilterParams } from "../../hooks/useFilterParams";
import { useCountyGeoJson } from "../../hooks/useCountyGeoJson";
import { useTractBurden, useTractGeoJson } from "../../hooks/useTractBurden";
import {
  burdenValue,
  cesHighlightColor,
  noDataFill,
  CES_TOP_QUARTILE,
  type TractBurdenRow,
} from "../../lib/map/tractBurden";
import { quantileBuckets, bucketFor } from "../../lib/choropleth/binning";
import { getPalette } from "../../lib/choropleth/palettes";
import { useIsDark } from "../../context/ThemeContext";

/** Above countyPane (450) and the highway pane — see the pane comment below. */
const TRACT_PANE = "tractBurdenPane";
const TRACT_PANE_Z = 460;

interface TractBurdenLayerProps {
  /** Same handlers CountyBoundaries gets — see the click-forwarding note. */
  onFocusCounty?: (name: string | null) => void;
  onSelectCounty?: (name: string) => void;
}

function tooltipHtml(
  row: TractBurdenRow | undefined,
  geoid: string,
  rateMode: boolean,
): string {
  if (!row) return `Tract ${geoid}<br/>no data`;
  // No ordinal suffix: "3th"/"21th" is the classic naive-suffix bug, and the
  // rule costs more than the word "percentile".
  const ces =
    row.ces_percentile == null
      ? "no CES score"
      : `CES percentile ${Math.round(row.ces_percentile)}`;
  // Name the units when this tract falls back to a count while the legend
  // shows a rate, so the two never silently disagree.
  const burden =
    rateMode && row.crashes_per_1k_pop != null
      ? `${row.crashes_per_1k_pop.toLocaleString()} per 1,000 residents`
      : rateMode
        ? `${row.crash_count.toLocaleString()} crashes (no population figure)`
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
 * choropleth's palette and binning, with the top CES quartile outlined. A
 * 2x2 bivariate scheme was the alternative; it needs a new palette, a new
 * legend geometry and its own colour-blindness story, and the one thing this
 * layer has to communicate — "burdened communities are outlined; darker means
 * more crashes there" — a sequential ramp plus an outline already says.
 *
 * Both the boundary file and the aggregate are fetched only while the toggle
 * is on (1.4 MB of TopoJSON is not something to pull on first paint).
 *
 * The caveats this layer cannot omit live in TractBurdenLegend: it covers
 * only crashes with coordinates, and it is an association, not a cause.
 */
export default memo(function TractBurdenLayer({
  onFocusCounty,
  onSelectCounty,
}: TractBurdenLayerProps) {
  const map = useMap();
  const isDark = useIsDark();
  const { otherLayers, palette } = useLayersState();
  const { selectedDateRange } = useFilterParams();
  const enabled = otherLayers.tractBurden;

  const { data: geojson } = useTractGeoJson(enabled);
  const { data: burden } = useTractBurden(selectedDateRange, enabled);
  // Already fetched by CountyBoundaries with staleTime: Infinity, so this is
  // a cache read. It is how a tract's county_code becomes the county NAME the
  // drilldown handlers take.
  const { data: counties } = useCountyGeoJson();

  const layerRef = useRef<L.GeoJSON | null>(null);

  const countyNameByCode = useMemo(() => {
    const out: Record<number, string> = {};
    for (const f of counties?.features ?? []) {
      const code = f.properties?.county_code;
      const name = f.properties?.name;
      if (code != null && name) out[Number(code)] = String(name);
    }
    return out;
  }, [counties]);

  const byGeoid = useMemo(() => {
    const out: Record<string, TractBurdenRow> = {};
    for (const row of burden?.tracts ?? []) out[row.geoid] = row;
    return out;
  }, [burden]);

  // Whether the RAMP is a rate. Individual tracts may still lack a population
  // inside a rate response — those get the no-data fill and a labelled count.
  const rateMode = burden?.summary.population_available ?? false;

  const edges = useMemo(() => {
    const values: number[] = [];
    for (const row of burden?.tracts ?? []) {
      const v = burdenValue(row, rateMode);
      if (v != null && v > 0) values.push(v);
    }
    return quantileBuckets(values, 5);
  }, [burden, rateMode]);

  // Handlers are bound once per layer build; refs keep them current without
  // rebuilding 9,100 features every time a parent re-renders.
  const handlersRef = useRef({ onFocusCounty, onSelectCounty });
  handlersRef.current = { onFocusCounty, onSelectCounty };

  useEffect(() => {
    if (!map.getPane(TRACT_PANE)) {
      const pane = map.createPane(TRACT_PANE);
      // Above countyPane (450). Below it, the county polygons win DOM hit
      // testing and the per-tract tooltip never fires — and a canvas renderer
      // covers the WHOLE viewport, so it would swallow every click anyway.
      // Sitting on top and forwarding the click (below) is what keeps county
      // drill-down working; HighwayDangerLayer's pane is raised above this
      // one so its routes stay clickable too.
      pane.style.zIndex = String(TRACT_PANE_Z);
    }
  }, [map]);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    if (!enabled || !geojson || !burden) return;

    const colors = getPalette(palette, isDark);
    const highlight = cesHighlightColor(isDark);
    const noData = noDataFill(isDark);
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
          const value = row ? burdenValue(row, rateMode) : null;
          const burdened =
            row?.ces_percentile != null && row.ces_percentile >= CES_TOP_QUARTILE;
          const base: L.PathOptions = {
            renderer,
            color: burdened ? highlight : "transparent",
            weight: burdened ? 1 : 0,
            fillOpacity: 0.65,
          };
          if (!row) {
            // Not in the response at all — draw nothing rather than invent a
            // value, but keep the shape so the pane's hit test is uniform.
            return { ...base, fillOpacity: 0, fillColor: noData };
          }
          if (value == null) {
            // In the response, but with no population while the ramp is a
            // rate. Visible and distinct: a hole would read as "no tract".
            return { ...base, fillColor: noData, fillOpacity: 0.45 };
          }
          if (value <= 0 || !edges) {
            return { ...base, fillColor: colors[0], fillOpacity: 0.35 };
          }
          return { ...base, fillColor: colors[bucketFor(value, edges)] };
        },
        onEachFeature: (f, featureLayer) => {
          const geoid = String(f?.id ?? "");
          const row = byGeoid[geoid];
          featureLayer.bindTooltip(tooltipHtml(row, geoid, rateMode), {
            sticky: true,
            className: "tract-burden-tooltip",
          });
          if (!row) return;
          // This pane is on top, so Leaflet resolves every click against the
          // tract canvas and the county polygons below never see one. Each
          // row carries its county, so hand the click straight to the same
          // handlers CountyBoundaries uses and drill-down keeps working.
          featureLayer.on("click", () => {
            const name = countyNameByCode[row.county_code];
            if (!name) return;
            handlersRef.current.onFocusCounty?.(name);
            handlersRef.current.onSelectCounty?.(name);
          });
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
  }, [map, enabled, geojson, burden, byGeoid, edges, palette, isDark, rateMode, countyNameByCode]);

  return null;
});

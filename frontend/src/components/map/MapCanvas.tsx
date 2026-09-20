import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { MapContainer, TileLayer, Marker, AttributionControl, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { LatLngBoundsExpression, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});
import CountyBoundaries from "./CountyBoundaries";
import HighwayDangerLayer from "./HighwayDangerLayer";
import TopIntersectionsLayer from "./TopIntersectionsLayer";
import CrashHeatmap from "./CrashHeatmap";
import CoordMismatchLayer from "./CoordMismatchLayer";
import CaliforniaMask from "./CaliforniaMask";
import OverlayMarkers from "./OverlayMarkers";
import CrashDotLayer from "./CrashDotLayer";
import ClusterLayer from "./ClusterLayer";
import ReservoirLayer from "./ReservoirLayer";
import TractBurdenLayer from "./TractBurdenLayer";
import type { HeatmapPoint } from "../../hooks/useCrashHeatmap";
import type { ClusterPoint } from "../../hooks/useClusterHotspots";
import type { HighwayRow } from "../../hooks/useHighwayRankings";
import type { ViewportSeed } from "../../hooks/useViewportParams";
import { useLayersState, type HeatmapResolution } from "../../hooks/useLayersState";
import { useHospitals, useSchoolCrashCounts, useSchools } from "../../hooks/useMapOverlays";
import type { PaletteKey } from "../../lib/choropleth/palettes";
import { useFilterParams } from "../../hooks/useFilterParams";
import { heatmapMaxZoom } from "../../lib/map/heatmapLod";
import { useIsDark } from "../../context/ThemeContext";
import { useToast } from "../ui/toastContext";
import { BASEMAPS, TILE_ERROR_LIMIT } from "../../lib/map/basemaps";
import { useAccessibility } from "../../context/AccessibilityContext";

function ReducedMotionSync() {
  const map = useMap();
  const { effectiveReducedMotion } = useAccessibility();
  useEffect(() => {
    map.options.zoomAnimation = !effectiveReducedMotion;
    map.options.fadeAnimation = !effectiveReducedMotion;
    map.options.markerZoomAnimation = !effectiveReducedMotion;
  }, [map, effectiveReducedMotion]);
  return null;
}

// axe/WCAG: Leaflet gives its container tabindex="0" (for keyboard pan) but no
// role or accessible name, so a screen reader lands on an unlabeled focusable
// div. react-leaflet's MapContainer doesn't forward arbitrary DOM attributes,
// so this sets them imperatively on the underlying element instead. The same
// county/highway/intersection figures are also readable as text on the Stats
// page, so a descriptive label (not a full data dump) is enough here.
function MapA11y() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "Interactive map of California traffic crash data by county");
  }, [map]);
  return null;
}

// Delay before the URL starts tracking the viewport — long enough to swallow
// the moveend/zoomend events Leaflet fires while settling its initial view
// (and the first invalidateSize), so an untouched map keeps a clean URL.
const VIEWPORT_SYNC_WARMUP_MS = 700;
// Coalesce bursts of zoomend (e.g. rapid scroll-wheel ticks) into one write.
const VIEWPORT_SYNC_DEBOUNCE_MS = 250;

/**
 * Mirrors the live map viewport into the URL on the trailing edge of pan/zoom.
 * Write-only: it never reads the URL back into the map, so there is no
 * pan → setSearchParams → re-render loop. See useViewportParams for the
 * read-once-on-mount seeding side.
 */
function ViewportSync({
  onChange,
}: {
  onChange: (center: [number, number], zoom: number) => void;
}) {
  const readyRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const warmup = window.setTimeout(() => {
      readyRef.current = true;
    }, VIEWPORT_SYNC_WARMUP_MS);
    return () => {
      window.clearTimeout(warmup);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  useMapEvents({
    moveend: (e) => scheduleWrite(e.target as LeafletMap),
    zoomend: (e) => scheduleWrite(e.target as LeafletMap),
  });

  function scheduleWrite(map: LeafletMap) {
    if (!readyRef.current) return;
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const c = map.getCenter();
      onChange([c.lat, c.lng], map.getZoom());
    }, VIEWPORT_SYNC_DEBOUNCE_MS);
  }

  return null;
}

const CA_CENTER: [number, number] = [37.2, -119.5];

function getInitialZoom(): number {
  return typeof window !== "undefined" && window.innerWidth < 768 ? 5 : 6;
}

const CA_BOUNDS: LatLngBoundsExpression = [
  [28.0, -127.0],
  [46.0, -112.0],
];

interface MapCanvasProps {
  focusedCounty: string | null;
  compareCounty?: string | null;
  onFocusCounty: (name: string | null) => void;
  onSelectCounty: (name: string) => void;
  onSelectHighway: (row: HighwayRow) => void;
  onSelectCluster: (cluster: ClusterPoint) => void;
  /** Route whose side panel is open — threaded to HighwayDangerLayer so the
   * panel re-syncs when the rankings refetch on a filter change (M-F5). */
  selectedHighwayRoute?: string | null;
  onSelectedHighwayGone?: () => void;
  /** Cluster whose side panel is open — threaded to ClusterLayer so the panel
   * re-syncs when the hotspots refetch on a filter change (M18). */
  selectedCluster?: ClusterPoint | null;
  onSelectedClusterGone?: () => void;
  onMapReady: (map: LeafletMap) => void;
  heatmapPoints: HeatmapPoint[];
  /** Full-detail crashes for the current viewport — see CrashDotLayer. */
  dotPoints?: HeatmapPoint[];
  /** Fatal-only points for the emphasis heat layer. */
  fatalPoints?: HeatmapPoint[];
  heatmapActive: boolean;
  /** True when the heatmap query is scoped to one or two counties. */
  heatmapScoped?: boolean;
  heatmapResolution: HeatmapResolution;
  heatmapPalette: PaletteKey;
  countyDrilldown?: boolean;
  mismatchPoints?: HeatmapPoint[];
  tempMarker?: [number, number] | null;
  /** Seeds the initial camera from the URL; read once on mount. */
  initialView?: ViewportSeed | null;
  /** Called (debounced) whenever the user pans/zooms, to mirror into the URL. */
  onViewportChange?: (center: [number, number], zoom: number) => void;
}

function MapInternals({
  focusedCounty,
  compareCounty,
  onFocusCounty,
  onSelectCounty,
  onSelectHighway,
  onSelectCluster,
  selectedHighwayRoute,
  onSelectedHighwayGone,
  selectedCluster,
  onSelectedClusterGone,
  onMapReady,
  heatmapPoints,
  dotPoints = [],
  fatalPoints = [],
  heatmapActive,
  heatmapScoped = false,
  heatmapResolution,
  heatmapPalette,
  countyDrilldown,
  mismatchPoints = [],
  tempMarker,
}: MapCanvasProps) {
  const map = useMap();
  const { otherLayers } = useLayersState();
  const showMask = heatmapActive && !otherLayers.coordMismatches && !countyDrilldown;
  const { data: hospitals = [], isError: hospitalsError } = useHospitals(otherLayers.hospitals);
  const { data: schools = [], isError: schoolsError } = useSchools(otherLayers.schools);
  // Nearby-crash counts follow the map's year filter, so they refetch when it
  // changes while the (static) school list stays cached.
  const { selectedYears } = useFilterParams();
  const { data: schoolCrashCounts, isError: schoolCountsError } =
    useSchoolCrashCounts(otherLayers.schools, selectedYears);
  const { showToast: showLayerToast } = useToast();
  useEffect(() => {
    if (hospitalsError) showLayerToast("Couldn't load hospitals.", { variant: "error" });
    if (schoolsError) showLayerToast("Couldn't load schools.", { variant: "error" });
    // Without this a failed fetch renders as "every school gray", which looks
    // exactly like "no crashes near any school" and like "the view isn't
    // populated yet". Three very different things, one appearance.
    if (schoolCountsError) showLayerToast("Couldn't load crash counts near schools.", { variant: "error" });
  }, [hospitalsError, schoolsError, schoolCountsError, showLayerToast]);

  useEffect(() => {
    onMapReady(map);
  }, [map, onMapReady]);

  useEffect(() => {
    if (!map) return;
    const pane = map.getPane("labelPane");
    if (!pane) {
      map.createPane("labelPane");
      map.getPane("labelPane")!.style.zIndex = "650";
    }
    if (!map.getPane("crashDotPane")) {
      map.createPane("crashDotPane");
      map.getPane("crashDotPane")!.style.zIndex = "625";
    }
  }, [map]);

  // The ceiling is the *ladder's* limit, not the current rung's: MapPage steps
  // the resolution finer as the zoom crosses each rung (see lib/map/heatmapLod),
  // so clamping to the rung in hand would stop the zoom two pinches in — the
  // "zoom stops at 9" report. Unscoped selections still stop where the coarsest
  // statewide grid runs out, because the API can't serve high/raw without a
  // county filter.
  useLayoutEffect(() => {
    const maxZ = heatmapActive ? heatmapMaxZoom(heatmapScoped || !!countyDrilldown) : 14;
    map.setMaxZoom(maxZ);
    if (map.getZoom() > maxZ) {
      map.setZoom(maxZ);
    }
  }, [map, heatmapActive, heatmapScoped, countyDrilldown]);

  return (
    <>
      <CountyBoundaries
        focusedCounty={focusedCounty}
        compareCounty={compareCounty}
        heatmapActive={heatmapActive}
        onFocusCounty={onFocusCounty}
        onSelectCounty={onSelectCounty}
      />
      <HighwayDangerLayer
        onSelectHighway={onSelectHighway}
        selectedRoute={selectedHighwayRoute}
        onSelectedRouteGone={onSelectedHighwayGone}
      />
      <ClusterLayer
        onSelectCluster={onSelectCluster}
        selectedCluster={selectedCluster}
        onSelectedClusterGone={onSelectedClusterGone}
      />
      <TopIntersectionsLayer county={focusedCounty ? focusedCounty.toLowerCase().replace(/\s+/g, "-") : null} />
      <ReservoirLayer />
      <TractBurdenLayer
        onFocusCounty={onFocusCounty}
        onSelectCounty={onSelectCounty}
      />
      {heatmapActive && (
        <CrashHeatmap
          points={heatmapPoints}
          fatalPoints={fatalPoints}
          resolution={heatmapResolution}
          palette={heatmapPalette}
        />
      )}
      {showMask && (
        <CaliforniaMask
          focusedCounty={countyDrilldown ? focusedCounty : null}
          compareCounty={countyDrilldown ? (compareCounty ?? null) : null}
        />
      )}
      {/* Dots come from their own viewport-scoped fetch (bbox + limit), not
          from the heat layer's points — those are slim (no severity, no
          popup fields) and, past the point budget, grid-aggregated. */}
      <CrashDotLayer points={dotPoints} enabled={heatmapActive} palette={heatmapPalette} />
      {mismatchPoints.length > 0 && <CoordMismatchLayer points={mismatchPoints} palette={heatmapPalette} />}
      <OverlayMarkers
        hospitals={hospitals}
        schools={schools}
        showHospitals={otherLayers.hospitals}
        showSchools={otherLayers.schools}
        schoolCrashCounts={schoolCrashCounts}
      />
      {tempMarker && <Marker position={tempMarker} />}
    </>
  );
}

export default function MapCanvas({
  focusedCounty,
  compareCounty,
  onFocusCounty,
  onSelectCounty,
  onSelectHighway,
  onSelectCluster,
  selectedHighwayRoute,
  onSelectedHighwayGone,
  selectedCluster,
  onSelectedClusterGone,
  onMapReady,
  heatmapPoints,
  dotPoints,
  fatalPoints,
  heatmapActive,
  heatmapScoped,
  heatmapResolution,
  heatmapPalette,
  countyDrilldown,
  mismatchPoints = [],
  tempMarker,
  initialView,
  onViewportChange,
}: MapCanvasProps) {
  const isDark = useIsDark();
  const { showToast } = useToast();

  // Walk the provider list on repeated tile failures rather than leaving a
  // blank canvas: a provider that goes down or changes its URL scheme costs a
  // few seconds of grey, not the map. See lib/map/basemaps.ts.
  const [basemapIndex, setBasemapIndex] = useState(0);
  const basemapIndexRef = useRef(0);
  const basemap = BASEMAPS[Math.min(basemapIndex, BASEMAPS.length - 1)];
  const baseTileUrl = basemap.base(isDark);
  const labelTileUrl = basemap.labels?.(isDark) ?? null;

  const tileErrorCount = useRef(0);
  const [tilesUnavailable, setTilesUnavailable] = useState(false);
  // Mirrors tilesUnavailable: tileload fires once per tile, and an unguarded
  // setState would schedule work on every one of them.
  const tilesUnavailableRef = useRef(false);

  const handleTileError = useCallback(() => {
    tileErrorCount.current += 1;
    if (tileErrorCount.current < TILE_ERROR_LIMIT) return;
    tileErrorCount.current = 0;
    if (basemapIndexRef.current < BASEMAPS.length - 1) {
      basemapIndexRef.current += 1;
      console.warn(
        `[MapCanvas] ${BASEMAPS[basemapIndexRef.current - 1].name} tiles failing; falling back to ${BASEMAPS[basemapIndexRef.current].name}`,
      );
      setBasemapIndex(basemapIndexRef.current);
    } else if (!tilesUnavailableRef.current) {
      tilesUnavailableRef.current = true;
      setTilesUnavailable(true);
    }
  }, []);

  const handleTileLoad = useCallback(() => {
    if (tileErrorCount.current > 0) tileErrorCount.current = 0;
    if (!tilesUnavailableRef.current) return;
    tilesUnavailableRef.current = false;
    setTilesUnavailable(false);
  }, []);

  // Surfaced as a toast rather than a bar pinned to the top of the map: that
  // bar sat on top of the mobile search/locate/share/filter row.
  useEffect(() => {
    if (!tilesUnavailable) return;
    showToast("Map tiles failed to load. Check your connection.", { variant: "error" });
  }, [tilesUnavailable, showToast]);

  const tileEvents = { tileerror: handleTileError, tileload: handleTileLoad };

  return (
    <>
    <MapContainer
      center={initialView?.center ?? CA_CENTER}
      zoom={initialView?.zoom ?? getInitialZoom()}
      className="h-full w-full z-0"
      zoomControl={false}
      attributionControl={false}
      maxBounds={CA_BOUNDS}
      maxBoundsViscosity={1.0}
      minZoom={5}
      maxZoom={18}
      // Keep zoom animation on — leaflet.heat's _animateZoom handler needs it
      // to CSS-transform the canvas during pinch. Without this the canvas
      // stays at the old position while the map pane moves underneath it.
      // The tile ghosting is fixed separately via CSS (will-change: auto).
      zoomAnimation={true}
      zoomAnimationThreshold={4}
    >
      <ReducedMotionSync />
      <MapA11y />
      {onViewportChange && <ViewportSync onChange={onViewportChange} />}
      {/* Required tile-provider credit. The MapContainer disables the default
          control (to drop the "Leaflet" promo prefix); this renders the one
          remaining, obligatory OSM + CARTO attribution. PNG export strips
          leaflet controls, so it doesn't appear in exports. */}
      <AttributionControl position="bottomright" prefix={false} />
      <TileLayer
        key={baseTileUrl}
        url={baseTileUrl}
        keepBuffer={2}
        maxNativeZoom={basemap.maxNativeZoom}
        attribution={basemap.attribution}
        eventHandlers={tileEvents}
      />

      <MapInternals
        focusedCounty={focusedCounty}
        compareCounty={compareCounty}
        onFocusCounty={onFocusCounty}
        onSelectCounty={onSelectCounty}
        onSelectHighway={onSelectHighway}
        onSelectCluster={onSelectCluster}
        selectedHighwayRoute={selectedHighwayRoute}
        onSelectedHighwayGone={onSelectedHighwayGone}
        selectedCluster={selectedCluster}
        onSelectedClusterGone={onSelectedClusterGone}
        onMapReady={onMapReady}
        heatmapPoints={heatmapPoints}
        dotPoints={dotPoints}
        fatalPoints={fatalPoints}
        heatmapActive={heatmapActive}
        heatmapScoped={heatmapScoped}
        heatmapResolution={heatmapResolution}
        heatmapPalette={heatmapPalette}
        countyDrilldown={countyDrilldown}
        mismatchPoints={mismatchPoints}
        tempMarker={tempMarker}
      />

      {labelTileUrl && (
        <TileLayer
          key={labelTileUrl}
          url={labelTileUrl}
          keepBuffer={2}
          maxNativeZoom={basemap.maxNativeZoom}
          pane="labelPane"
        />
      )}
    </MapContainer>
    </>
  );
}

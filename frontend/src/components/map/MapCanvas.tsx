import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
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
import type { HeatmapPoint } from "../../hooks/useCrashHeatmap";
import type { ClusterPoint } from "../../hooks/useClusterHotspots";
import type { HighwayRow } from "../../hooks/useHighwayRankings";
import type { ViewportSeed } from "../../hooks/useViewportParams";
import { useLayersState, type HeatmapResolution } from "../../hooks/useLayersState";
import { useHospitals, useSchools } from "../../hooks/useMapOverlays";
import type { PaletteKey } from "../../lib/choropleth/palettes";
import { useIsDark } from "../../context/ThemeContext";
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
  heatmapActive: boolean;
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

const HEATMAP_MAX_ZOOM: Record<string, number> = {
  raw: 18,
  low: 8,
  medium: 9,
  high: 10,
};

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
  heatmapActive,
  heatmapResolution,
  heatmapPalette,
  countyDrilldown,
  mismatchPoints = [],
  tempMarker,
}: MapCanvasProps) {
  const map = useMap();
  const { otherLayers } = useLayersState();
  const showMask = heatmapActive && !otherLayers.coordMismatches && !countyDrilldown;
  const { data: hospitals = [] } = useHospitals(otherLayers.hospitals);
  const { data: schools = [] } = useSchools(otherLayers.schools);

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

  useLayoutEffect(() => {
    const effectiveResolution = countyDrilldown ? "raw" : heatmapResolution;
    const maxZ = heatmapActive ? (HEATMAP_MAX_ZOOM[effectiveResolution] ?? 12) : 14;
    map.setMaxZoom(maxZ);
    if (map.getZoom() > maxZ) {
      map.setZoom(maxZ);
    }
  }, [map, heatmapActive, heatmapResolution, countyDrilldown]);

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
      {heatmapActive && (
        <CrashHeatmap
          points={heatmapPoints}
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
      <CrashDotLayer points={heatmapPoints} enabled={heatmapActive && heatmapResolution === "raw"} palette={heatmapPalette} />
      {mismatchPoints.length > 0 && <CoordMismatchLayer points={mismatchPoints} palette={heatmapPalette} />}
      <OverlayMarkers
        hospitals={hospitals}
        schools={schools}
        showHospitals={otherLayers.hospitals}
        showSchools={otherLayers.schools}
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
  heatmapActive,
  heatmapResolution,
  heatmapPalette,
  countyDrilldown,
  mismatchPoints = [],
  tempMarker,
  initialView,
  onViewportChange,
}: MapCanvasProps) {
  const isDark = useIsDark();
  const baseTileUrl = isDark
    ? "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png";
  const labelTileUrl = isDark
    ? "https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png";

  const tileErrorCount = useRef(0);
  const [tileWarning, setTileWarning] = useState(false);

  const handleTileError = useCallback(() => {
    tileErrorCount.current += 1;
    if (tileErrorCount.current >= 5 && !tileWarning) {
      console.warn(`[MapCanvas] ${tileErrorCount.current} consecutive tile failures`);
      setTileWarning(true);
    }
  }, [tileWarning]);

  const handleTileLoad = useCallback(() => {
    if (tileErrorCount.current > 0) {
      tileErrorCount.current = 0;
      setTileWarning(false);
    }
  }, []);

  const tileEvents = { tileerror: handleTileError, tileload: handleTileLoad };

  return (
    <>
    {tileWarning && (
      <div role="alert" className="absolute top-0 left-0 right-0 z-[1000] bg-error-container text-on-error-container text-xs text-center py-1.5 px-4">
        Map tiles failed to load. Check your network connection.
      </div>
    )}
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
      {onViewportChange && <ViewportSync onChange={onViewportChange} />}
      <TileLayer
        key={baseTileUrl}
        url={baseTileUrl}
        keepBuffer={2}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/">CARTO</a>'
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
        heatmapActive={heatmapActive}
        heatmapResolution={heatmapResolution}
        heatmapPalette={heatmapPalette}
        countyDrilldown={countyDrilldown}
        mismatchPoints={mismatchPoints}
        tempMarker={tempMarker}
      />

      <TileLayer
        key={labelTileUrl}
        url={labelTileUrl}
        keepBuffer={2}
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        pane="labelPane"
        eventHandlers={tileEvents}
      />
    </MapContainer>
    </>
  );
}

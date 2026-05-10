import { useEffect, useLayoutEffect } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import type { LatLngBoundsExpression, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import CountyBoundaries from "./CountyBoundaries";
import CrashHeatmap from "./CrashHeatmap";
import CoordMismatchLayer from "./CoordMismatchLayer";
import CaliforniaMask from "./CaliforniaMask";
import OverlayMarkers from "./OverlayMarkers";
import type { HeatmapPoint } from "../../hooks/useCrashHeatmap";
import { useLayersState, type HeatmapResolution } from "../../hooks/useLayersState";
import { useHospitals, useSchools } from "../../hooks/useMapOverlays";
import type { PaletteKey } from "../../lib/choropleth/palettes";
import { useIsDark } from "../../context/ThemeContext";

const CA_CENTER: [number, number] = [37.2, -119.5];
const isMobile = window.innerWidth < 768;
const CA_ZOOM = isMobile ? 5 : 6;

const CA_BOUNDS: LatLngBoundsExpression = [
  [28.0, -127.0],
  [46.0, -112.0],
];

interface MapCanvasProps {
  focusedCounty: string | null;
  compareCounty?: string | null;
  onFocusCounty: (name: string | null) => void;
  onSelectCounty: (name: string) => void;
  onMapReady: (map: LeafletMap) => void;
  heatmapPoints: HeatmapPoint[];
  heatmapActive: boolean;
  heatmapResolution: HeatmapResolution;
  heatmapPalette: PaletteKey;
  countyDrilldown?: boolean;
  mismatchPoints?: HeatmapPoint[];
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
  onMapReady,
  heatmapPoints,
  heatmapActive,
  heatmapResolution,
  heatmapPalette,
  countyDrilldown,
  mismatchPoints = [],
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
      {mismatchPoints.length > 0 && <CoordMismatchLayer points={mismatchPoints} palette={heatmapPalette} />}
      <OverlayMarkers
        hospitals={hospitals}
        schools={schools}
        showHospitals={otherLayers.hospitals}
        showSchools={otherLayers.schools}
      />
    </>
  );
}

export default function MapCanvas({
  focusedCounty,
  compareCounty,
  onFocusCounty,
  onSelectCounty,
  onMapReady,
  heatmapPoints,
  heatmapActive,
  heatmapResolution,
  heatmapPalette,
  countyDrilldown,
  mismatchPoints = [],
}: MapCanvasProps) {
  const isDark = useIsDark();
  // CartoDB tile variants — swap between light_* and dark_* so counties
  // retain contrast against the basemap in either theme. The `key` on the
  // TileLayer forces React to tear down + remount when the theme flips,
  // because react-leaflet otherwise caches the initial URL.
  const baseTileUrl = isDark
    ? "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png";
  const labelTileUrl = isDark
    ? "https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png";

  return (
    <MapContainer
      center={CA_CENTER}
      zoom={CA_ZOOM}
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
      <TileLayer
        key={baseTileUrl}
        url={baseTileUrl}
        keepBuffer={2}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />

      <MapInternals
        focusedCounty={focusedCounty}
        compareCounty={compareCounty}
        onFocusCounty={onFocusCounty}
        onSelectCounty={onSelectCounty}
        onMapReady={onMapReady}
        heatmapPoints={heatmapPoints}
        heatmapActive={heatmapActive}
        heatmapResolution={heatmapResolution}
        heatmapPalette={heatmapPalette}
        countyDrilldown={countyDrilldown}
        mismatchPoints={mismatchPoints}
      />

      <TileLayer
        key={labelTileUrl}
        url={labelTileUrl}
        keepBuffer={2}
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        pane="labelPane"
      />
    </MapContainer>
  );
}

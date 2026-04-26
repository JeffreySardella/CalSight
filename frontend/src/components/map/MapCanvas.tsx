import { useEffect } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import type { LatLngBoundsExpression, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import CountyBoundaries from "./CountyBoundaries";
import { useIsDark } from "../../context/ThemeContext";

const CA_CENTER: [number, number] = [37.2, -119.5];
const CA_ZOOM = 6;

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
}

function MapInternals({
  focusedCounty,
  compareCounty,
  onFocusCounty,
  onSelectCounty,
  onMapReady,
}: MapCanvasProps) {
  const map = useMap();

  useEffect(() => {
    onMapReady(map);
  }, [map, onMapReady]);

  return (
    <CountyBoundaries
      focusedCounty={focusedCounty}
      compareCounty={compareCounty}
      onFocusCounty={onFocusCounty}
      onSelectCounty={onSelectCounty}
    />
  );
}

export default function MapCanvas({
  focusedCounty,
  compareCounty,
  onFocusCounty,
  onSelectCounty,
  onMapReady,
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
      maxZoom={14}
      zoomAnimation={true}
      zoomAnimationThreshold={4}
    >
      <TileLayer
        key={baseTileUrl}
        url={baseTileUrl}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />

      <MapInternals
        focusedCounty={focusedCounty}
        compareCounty={compareCounty}
        onFocusCounty={onFocusCounty}
        onSelectCounty={onSelectCounty}
        onMapReady={onMapReady}
      />

      <TileLayer
        key={labelTileUrl}
        url={labelTileUrl}
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
      />
    </MapContainer>
  );
}

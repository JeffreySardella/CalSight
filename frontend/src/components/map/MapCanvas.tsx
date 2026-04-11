import { useEffect } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import type { LatLngBoundsExpression, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import CountyBoundaries from "./CountyBoundaries";

const CA_CENTER: [number, number] = [37.2, -119.5];
const CA_ZOOM = 6;

const CA_BOUNDS: LatLngBoundsExpression = [
  [28.0, -127.0],
  [46.0, -112.0],
];

interface MapCanvasProps {
  focusedCounty: string | null;
  onFocusCounty: (name: string | null) => void;
  onSelectCounty: (name: string) => void;
  onMapReady: (map: LeafletMap) => void;
}

function MapInternals({
  focusedCounty,
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
      onFocusCounty={onFocusCounty}
      onSelectCounty={onSelectCounty}
    />
  );
}

export default function MapCanvas({
  focusedCounty,
  onFocusCounty,
  onSelectCounty,
  onMapReady,
}: MapCanvasProps) {
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
        url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />

      <MapInternals
        focusedCounty={focusedCounty}
        onFocusCounty={onFocusCounty}
        onSelectCounty={onSelectCounty}
        onMapReady={onMapReady}
      />

      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
      />
    </MapContainer>
  );
}

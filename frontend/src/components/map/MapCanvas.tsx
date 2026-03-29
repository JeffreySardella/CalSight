import { MapContainer, TileLayer } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";

/** California geographic center */
const CA_CENTER: [number, number] = [37.2, -119.5];
const CA_ZOOM = 6;

/** Restrict panning to California + some padding */
const CA_BOUNDS: LatLngBoundsExpression = [
  [32.0, -125.0], // Southwest corner
  [42.5, -114.0], // Northeast corner
];

export default function MapCanvas() {
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
    >
      {/* CartoDB Positron base (no labels) */}
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      {/* Labels rendered on top so they sit above any future data layers */}
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
      />
    </MapContainer>
  );
}

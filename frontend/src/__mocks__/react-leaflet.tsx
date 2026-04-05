import React from "react";
import { mockMapInstance } from "./leaflet";

export function MapContainer({ children }: { children: React.ReactNode }) {
  return <div data-testid="map-container">{children}</div>;
}

export function TileLayer() {
  return null;
}

export function useMap() {
  return mockMapInstance;
}

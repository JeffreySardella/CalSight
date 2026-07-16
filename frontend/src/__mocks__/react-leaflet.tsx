import React from "react";
import { mockMapInstance } from "./leaflet";

export function MapContainer({ children }: { children: React.ReactNode }) {
  return <div data-testid="map-container">{children}</div>;
}

export function TileLayer() {
  return null;
}

/** Declarative marker mock: renders as a plain div (position + icon html
 *  exposed as data attributes) with its children (e.g. Popup) inside, so
 *  tests can assert markers and popup content with testing-library. */
export function Marker({
  position,
  icon,
  children,
}: {
  position: [number, number];
  icon?: { html?: string };
  children?: React.ReactNode;
}) {
  return (
    <div
      data-testid="marker"
      data-position={JSON.stringify(position)}
      data-icon-html={icon?.html ?? ""}
    >
      {children}
    </div>
  );
}

export function Popup({ children }: { children?: React.ReactNode }) {
  return <div data-testid="popup">{children}</div>;
}

export function useMap() {
  return mockMapInstance;
}

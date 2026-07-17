import { vi } from "vitest";

export function createMockMap() {
  const listeners: Record<string, Array<() => void>> = {};
  const getBounds = vi.fn(() => ({
    contains: vi.fn(() => true),
    getCenter: vi.fn(() => ({ lat: 37.2, lng: -119.5 })),
    intersects: vi.fn(() => true),
  }));
  return {
    options: { zoomAnimation: true, fadeAnimation: true, markerZoomAnimation: true },
    panBy: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    setView: vi.fn(),
    panTo: vi.fn(),
    getBounds,
    removeLayer: vi.fn(),
    getPane: vi.fn(() => ({ style: {} })),
    createPane: vi.fn(() => ({ style: {} })),
    getZoom: vi.fn(() => 6),
    setMaxZoom: vi.fn(),
    setZoom: vi.fn(),
    fitBounds: vi.fn(),
    addTo: vi.fn(),
    eachLayer: vi.fn(),
    on: vi.fn((event: string, cb: () => void) => {
      (listeners[event] ??= []).push(cb);
    }),
    off: vi.fn((event: string, cb?: () => void) => {
      if (!cb) listeners[event] = [];
      else listeners[event] = (listeners[event] ?? []).filter((f) => f !== cb);
    }),
    fireEvent: (event: string) => {
      (listeners[event] ?? []).slice().forEach((cb) => cb());
    },
  };
}

export const mockMapInstance = createMockMap();

// Individual feature layer mocks — used by geoJSONLayerMock.eachLayer default impl
export const featureLayerMocks = [
  {
    feature: { type: "Feature", properties: { name: "Alameda", county_code: 1 }, geometry: {} },
    setStyle: vi.fn(),
    getBounds: vi.fn(() => ({
      intersects: vi.fn(() => true),
      getCenter: vi.fn(() => ({ lat: 37.8, lng: -122.2 })),
    })),
    on: vi.fn(),
  },
  {
    feature: { type: "Feature", properties: { name: "Fresno", county_code: 19 }, geometry: {} },
    setStyle: vi.fn(),
    getBounds: vi.fn(() => ({
      intersects: vi.fn(() => true),
      getCenter: vi.fn(() => ({ lat: 36.7, lng: -119.8 })),
    })),
    on: vi.fn(),
  },
];

const geoJSONLayerMock = {
  addTo: vi.fn().mockReturnThis(),
  eachLayer: vi.fn((cb: (layer: unknown) => void) => {
    for (const fl of featureLayerMocks) cb(fl);
  }),
  on: vi.fn(),
  setStyle: vi.fn(),
  getBounds: vi.fn(() => ({
    intersects: vi.fn(() => true),
    getCenter: vi.fn(() => ({ lat: 37, lng: -119 })),
  })),
};

const tooltipMock = {
  setLatLng: vi.fn().mockReturnThis(),
  setContent: vi.fn().mockReturnThis(),
  addTo: vi.fn().mockReturnThis(),
};

function createBoundsMock() {
  const bounds: Record<string, unknown> = {
    getCenter: vi.fn(() => ({ lat: 37, lng: -119 })),
    extend: vi.fn(() => bounds),
    intersects: vi.fn(() => true),
  };
  return bounds;
}

/** Records every circleMarker created, so tests can inspect coords + popup content. */
export interface CircleMarkerInstance {
  latlng: [number, number];
  opts: Record<string, unknown>;
  bindPopup: ReturnType<typeof vi.fn>;
  addTo: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}
export const circleMarkerInstances: CircleMarkerInstance[] = [];

/** Records every divIcon created, so tests can inspect the SVG html. */
export const divIconInstances: Array<Record<string, unknown>> = [];

const L = {
  geoJSON: vi.fn(() => geoJSONLayerMock),
  tooltip: vi.fn(() => tooltipMock),
  latLngBounds: vi.fn(() => createBoundsMock()),
  divIcon: vi.fn((opts: Record<string, unknown>) => {
    divIconInstances.push(opts);
    return opts;
  }),
  circleMarker: vi.fn((latlng: [number, number], opts: Record<string, unknown>) => {
    const inst: CircleMarkerInstance = {
      latlng,
      opts,
      bindPopup: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      on: vi.fn().mockReturnThis(),
    };
    circleMarkerInstances.push(inst);
    return inst;
  }),
  layerGroup: vi.fn(() => ({ addTo: vi.fn().mockReturnThis() })),
  Icon: { Default: { mergeOptions: vi.fn() } },
  DomUtil: { create: vi.fn(), remove: vi.fn() },
  DomEvent: { disableClickPropagation: vi.fn(), disableScrollPropagation: vi.fn() },
};

export default L;
export { geoJSONLayerMock, tooltipMock };

import { vi } from "vitest";

export function createMockMap() {
  const listeners: Record<string, Array<() => void>> = {};
  const getBounds = vi.fn(() => ({
    contains: vi.fn(() => true),
    getCenter: vi.fn(() => ({ lat: 37.2, lng: -119.5 })),
    intersects: vi.fn(() => true),
  }));
  return {
    panBy: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    setView: vi.fn(),
    panTo: vi.fn(),
    getBounds,
    removeLayer: vi.fn(),
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

const L = {
  geoJSON: vi.fn(() => geoJSONLayerMock),
  tooltip: vi.fn(() => tooltipMock),
  DomUtil: { create: vi.fn(), remove: vi.fn() },
  DomEvent: { disableClickPropagation: vi.fn(), disableScrollPropagation: vi.fn() },
};

export default L;
export { geoJSONLayerMock, tooltipMock };

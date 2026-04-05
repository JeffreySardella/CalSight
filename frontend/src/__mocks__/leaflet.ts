import { vi } from "vitest";

export function createMockMap() {
  return {
    panBy: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    setView: vi.fn(),
    getBounds: vi.fn(() => ({
      contains: vi.fn(() => true),
      getCenter: vi.fn(() => ({ lat: 37.2, lng: -119.5 })),
    })),
    removeLayer: vi.fn(),
    addTo: vi.fn(),
    eachLayer: vi.fn(),
  };
}

export const mockMapInstance = createMockMap();

const geoJSONLayerMock = {
  addTo: vi.fn().mockReturnThis(),
  eachLayer: vi.fn(),
  on: vi.fn(),
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

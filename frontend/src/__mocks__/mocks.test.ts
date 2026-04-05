import { describe, it, expect } from "vitest";
import { mockMapInstance } from "./leaflet";

describe("leaflet mock", () => {
  it("provides a mock map with expected methods", () => {
    expect(mockMapInstance.panBy).toBeDefined();
    expect(mockMapInstance.zoomIn).toBeDefined();
    expect(mockMapInstance.zoomOut).toBeDefined();
  });
});

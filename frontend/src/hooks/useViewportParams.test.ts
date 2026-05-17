import { describe, it, expect } from "vitest";
import { parseViewport } from "./useViewportParams";

function sp(obj: Record<string, string>): URLSearchParams {
  return new URLSearchParams(obj);
}

describe("parseViewport", () => {
  it("parses a full lat/lng/zoom triple", () => {
    expect(parseViewport(sp({ lat: "34.0500", lng: "-118.2400", zoom: "10" })))
      .toEqual({ center: [34.05, -118.24], zoom: 10 });
  });

  it("returns null center + null zoom for empty params", () => {
    expect(parseViewport(sp({}))).toEqual({ center: null, zoom: null });
  });

  it("honors zoom without lat/lng (county deep-link case)", () => {
    expect(parseViewport(sp({ zoom: "12" }))).toEqual({ center: null, zoom: 12 });
  });

  it("drops a lone lat with no lng", () => {
    expect(parseViewport(sp({ lat: "34.05" }))).toEqual({ center: null, zoom: null });
  });

  it("drops out-of-range latitude", () => {
    expect(parseViewport(sp({ lat: "80", lng: "-118", zoom: "8" })).center).toBeNull();
  });

  it("drops out-of-range longitude", () => {
    expect(parseViewport(sp({ lat: "34", lng: "-50", zoom: "8" })).center).toBeNull();
  });

  it("drops out-of-range zoom on both ends", () => {
    expect(parseViewport(sp({ zoom: "25" })).zoom).toBeNull();
    expect(parseViewport(sp({ zoom: "2" })).zoom).toBeNull();
  });

  it("drops non-numeric values", () => {
    expect(parseViewport(sp({ lat: "abc", lng: "-118", zoom: "x" })))
      .toEqual({ center: null, zoom: null });
  });

  it("accepts zoom at the boundaries", () => {
    expect(parseViewport(sp({ zoom: "5" })).zoom).toBe(5);
    expect(parseViewport(sp({ zoom: "18" })).zoom).toBe(18);
  });

  it("keeps a valid zoom even when lat/lng are out of range", () => {
    expect(parseViewport(sp({ lat: "99", lng: "0", zoom: "9" })))
      .toEqual({ center: null, zoom: 9 });
  });
});

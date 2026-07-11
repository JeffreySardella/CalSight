import { describe, it, expect } from "vitest";
import { findCountyAtPoint } from "./pointInCounty";

// GeoJSON coordinates are [lng, lat]; findCountyAtPoint takes (lat, lng).
function feature(
  name: string | undefined,
  geometry: GeoJSON.Geometry,
): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: name === undefined ? null : { name },
    geometry,
  };
}

function fc(...features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features };
}

const unitSquare: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
  ],
};

describe("findCountyAtPoint (ray casting)", () => {
  it("finds a point strictly inside a simple polygon", () => {
    expect(findCountyAtPoint(5, 5, fc(feature("Kern", unitSquare)))).toBe("Kern");
  });

  it("returns null for a point outside every polygon", () => {
    expect(findCountyAtPoint(20, 20, fc(feature("Kern", unitSquare)))).toBeNull();
    expect(findCountyAtPoint(-5, 5, fc(feature("Kern", unitSquare)))).toBeNull();
  });

  it("returns null for a point aligned with an edge but outside (ray crosses two vertices)", () => {
    // lat=0 is collinear with the bottom edge; point sits left of the square.
    expect(findCountyAtPoint(0, -5, fc(feature("Kern", unitSquare)))).toBeNull();
  });

  it("excludes points inside a hole (interior ring)", () => {
    const donut: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
      ],
    };
    const collection = fc(feature("Donut", donut));
    expect(findCountyAtPoint(5, 5, collection)).toBeNull(); // in the hole
    expect(findCountyAtPoint(2, 2, collection)).toBe("Donut"); // in the ring
    expect(findCountyAtPoint(5, 2, collection)).toBe("Donut"); // beside the hole, inside the ring
  });

  it("checks every part of a MultiPolygon", () => {
    const multi: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [
        [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
        [[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]],
      ],
    };
    const collection = fc(feature("Islands", multi));
    expect(findCountyAtPoint(1, 1, collection)).toBe("Islands");
    expect(findCountyAtPoint(11, 11, collection)).toBe("Islands");
    expect(findCountyAtPoint(5, 5, collection)).toBeNull(); // between the parts
  });

  it("skips non-polygon geometries instead of matching them", () => {
    const point: GeoJSON.Point = { type: "Point", coordinates: [5, 5] };
    expect(findCountyAtPoint(5, 5, fc(feature("NotAPolygon", point)))).toBeNull();
  });

  it("returns the first matching feature when polygons overlap", () => {
    const inner: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [[[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]],
    };
    const collection = fc(feature("First", unitSquare), feature("Second", inner));
    expect(findCountyAtPoint(5, 5, collection)).toBe("First");
  });

  it("returns null when the hit feature has no name property", () => {
    expect(findCountyAtPoint(5, 5, fc(feature(undefined, unitSquare)))).toBeNull();
  });

  it("handles concave polygons (point in the notch is outside)", () => {
    // U-shape: notch cut into the top between x=3..7 down to y=5.
    const uShape: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [[
        [0, 0], [10, 0], [10, 10], [7, 10], [7, 5], [3, 5], [3, 10], [0, 10], [0, 0],
      ]],
    };
    const collection = fc(feature("U", uShape));
    expect(findCountyAtPoint(7, 5, collection)).toBeNull(); // inside the notch
    expect(findCountyAtPoint(2, 1.5, collection)).toBe("U"); // left arm
    expect(findCountyAtPoint(7, 8.5, collection)).toBe("U"); // right arm
    expect(findCountyAtPoint(2, 5, collection)).toBe("U"); // base under the notch
  });
});

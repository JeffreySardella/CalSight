import { describe, it, expect } from "vitest";
import { countyBounds, countyCrashTotal, mappedLabel } from "./countySelection";

function square(name: string, west: number, south: number, size: number): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { name },
    geometry: {
      type: "Polygon",
      coordinates: [[[west, south], [west + size, south], [west + size, south + size], [west, south + size], [west, south]]],
    },
  };
}

const GEO: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [square("Fresno", -120, 36, 1), square("Kern", -119, 35, 1), square("Shasta", -123, 40, 1)],
};

describe("countyBounds", () => {
  it("frames one county", () => {
    const b = countyBounds(GEO, ["Fresno"])!;
    expect([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]).toEqual([-120, 36, -119, 37]);
  });

  it("frames the union of several", () => {
    const b = countyBounds(GEO, new Set(["Fresno", "Kern"]))!;
    expect([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]).toEqual([-120, 35, -118, 37]);
  });

  it("is null when nothing matches", () => {
    expect(countyBounds(GEO, ["Atlantis"])).toBeNull();
    expect(countyBounds(GEO, [])).toBeNull();
  });
});

describe("mappedLabel", () => {
  it("puts plotted crashes over crashes in scope", () => {
    expect(mappedLabel(107_112, 233_290)).toBe("107K of 233K crashes mapped (46%)");
    expect(mappedLabel(9_300_000, 11_600_000)).toBe("9.3M of 11.6M crashes mapped (80%)");
  });

  it("never claims more than all of them, and drops the share with no total", () => {
    expect(mappedLabel(520, 500)).toBe("520 of 500 crashes mapped (100%)");
    expect(mappedLabel(107_112, null)).toBe("107K crashes mapped");
  });
});

describe("countyCrashTotal", () => {
  const nameToCode = { Fresno: 10, Kern: 15 };
  const byCode = { 10: { rawCount: 233_290 }, 15: { rawCount: 300_000 } };

  it("sums the selected counties", () => {
    expect(countyCrashTotal(["Fresno"], nameToCode, byCode)).toBe(233_290);
    expect(countyCrashTotal(["Fresno", "Kern"], nameToCode, byCode)).toBe(533_290);
  });

  it("is null while a county's count is missing", () => {
    expect(countyCrashTotal(["Fresno", "Shasta"], nameToCode, byCode)).toBeNull();
    expect(countyCrashTotal(["Fresno"], {}, {})).toBeNull();
  });
});

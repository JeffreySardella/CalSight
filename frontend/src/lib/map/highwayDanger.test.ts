import { describe, expect, it } from "vitest";
import { buildDangerFeatures } from "./highwayDanger";
import type { HighwayRow } from "../../hooks/useHighwayRankings";

const COLORS = ["#fee5d9", "#fcae91", "#fb6a4a", "#de2d26", "#a50f15"];
const NO_DATA = "#cccccc";

function geoFor(ids: string[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: ids.map((id, i) => ({
      type: "Feature",
      properties: { route_number: id },
      geometry: { type: "LineString", coordinates: [[i, i], [i + 1, i + 1]] },
    })),
  };
}

function row(id: string, over: Partial<HighwayRow> = {}): HighwayRow {
  return {
    route_number: id,
    crash_count: 10,
    total_killed: 1,
    total_injured: 5,
    fatality_rate: 0.1,
    miles: 100,
    crashes_per_mile: 0.1,
    ...over,
  };
}

describe("buildDangerFeatures", () => {
  it("joins danger to geometry and grays routes with no data", () => {
    const geo = geoFor(["I-5", "SR-99"]);
    const out = buildDangerFeatures(geo, [row("I-5", { crash_count: 100 })], "crash_count", COLORS, NO_DATA);
    const i5 = out.find((f) => f.route_number === "I-5")!;
    const sr99 = out.find((f) => f.route_number === "SR-99")!;
    expect(i5.value).toBe(100);
    expect(i5.color).not.toBe(NO_DATA);
    expect(sr99.value).toBeNull();
    expect(sr99.color).toBe(NO_DATA);
  });

  it("buckets across the palette when enough routes have values", () => {
    const geo = geoFor(["A", "B", "C", "D", "E"]);
    const rows = [
      row("A", { crash_count: 1 }),
      row("B", { crash_count: 25 }),
      row("C", { crash_count: 50 }),
      row("D", { crash_count: 75 }),
      row("E", { crash_count: 100 }),
    ];
    const out = buildDangerFeatures(geo, rows, "crash_count", COLORS, NO_DATA);
    const lowest = out.find((f) => f.route_number === "A")!;
    const highest = out.find((f) => f.route_number === "E")!;
    expect(lowest.color).toBe(COLORS[0]);
    expect(highest.color).toBe(COLORS[COLORS.length - 1]);
  });

  it("treats a null metric (e.g. crashes_per_mile with no miles) as no-data", () => {
    const geo = geoFor(["I-5"]);
    const out = buildDangerFeatures(
      geo,
      [row("I-5", { miles: null, crashes_per_mile: null })],
      "crashes_per_mile",
      COLORS,
      NO_DATA,
    );
    expect(out[0].value).toBeNull();
    expect(out[0].color).toBe(NO_DATA);
  });
});

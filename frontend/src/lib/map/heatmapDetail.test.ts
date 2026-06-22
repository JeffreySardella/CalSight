import { describe, it, expect } from "vitest";
import { selectHeatmapDetailSlugs } from "./heatmapDetail";

describe("selectHeatmapDetailSlugs", () => {
  it("returns the URL filter's slug when one county is selected", () => {
    expect(
      selectHeatmapDetailSlugs({
        compareMode: false,
        focusedCounty: null,
        compareCounty: null,
        selectedCounties: new Set(["Sacramento"]),
      }),
    ).toEqual(["sacramento"]);
  });

  it("returns both slugs when two counties are selected via the URL filter", () => {
    const out = selectHeatmapDetailSlugs({
      compareMode: false,
      focusedCounty: null,
      compareCounty: null,
      selectedCounties: new Set(["Sacramento", "Los Angeles"]),
    });
    expect(out.sort()).toEqual(["los-angeles", "sacramento"]);
  });

  it("returns [] when 3+ counties are selected — auto-disable handles those", () => {
    expect(
      selectHeatmapDetailSlugs({
        compareMode: false,
        focusedCounty: null,
        compareCounty: null,
        selectedCounties: new Set(["Sacramento", "Los Angeles", "Fresno"]),
      }),
    ).toEqual([]);
  });

  it("returns [] when no counties are selected and we aren't in compareMode", () => {
    expect(
      selectHeatmapDetailSlugs({
        compareMode: false,
        focusedCounty: null,
        compareCounty: null,
        selectedCounties: new Set(),
      }),
    ).toEqual([]);
  });

  it("ignores selectedCounties in compareMode and uses focused/compare instead", () => {
    expect(
      selectHeatmapDetailSlugs({
        compareMode: true,
        focusedCounty: "Sacramento",
        compareCounty: "Fresno",
        selectedCounties: new Set(["Los Angeles", "Orange", "San Diego"]),
      }),
    ).toEqual(["sacramento", "fresno"]);
  });

  it("returns just the focused county in compareMode when no compare is set", () => {
    expect(
      selectHeatmapDetailSlugs({
        compareMode: true,
        focusedCounty: "Sacramento",
        compareCounty: null,
        selectedCounties: new Set(),
      }),
    ).toEqual(["sacramento"]);
  });

  it("returns [] in compareMode when neither focus nor compare is set", () => {
    expect(
      selectHeatmapDetailSlugs({
        compareMode: true,
        focusedCounty: null,
        compareCounty: null,
        selectedCounties: new Set(),
      }),
    ).toEqual([]);
  });

  it("slugifies multi-word county names with spaces", () => {
    expect(
      selectHeatmapDetailSlugs({
        compareMode: false,
        focusedCounty: null,
        compareCounty: null,
        selectedCounties: new Set(["San Francisco"]),
      }),
    ).toEqual(["san-francisco"]);
  });
});

import { describe, it, expect } from "vitest";
import { parseLayerParams } from "./useLayerParams";
import { DEFAULT_MEASURE } from "../lib/choropleth/measures";

function sp(obj: Record<string, string>): URLSearchParams {
  return new URLSearchParams(obj);
}

describe("parseLayerParams", () => {
  it("returns an empty seed for no params", () => {
    expect(parseLayerParams(sp({}))).toEqual({});
  });

  it("decodes a valid measure", () => {
    expect(parseLayerParams(sp({ measure: DEFAULT_MEASURE })).measure).toBe(DEFAULT_MEASURE);
  });

  it("ignores an unknown measure", () => {
    expect(parseLayerParams(sp({ measure: "not_a_measure" })).measure).toBeUndefined();
  });

  it("decodes a valid palette", () => {
    expect(parseLayerParams(sp({ palette: "colorblind" })).palette).toBe("colorblind");
  });

  it("ignores an unknown palette", () => {
    expect(parseLayerParams(sp({ palette: "rainbow" })).palette).toBeUndefined();
  });

  it("decodes choro=0 as choropleth off", () => {
    expect(parseLayerParams(sp({ choro: "0" })).choroplethOn).toBe(false);
  });

  it("decodes choro=1 as choropleth on", () => {
    expect(parseLayerParams(sp({ choro: "1" })).choroplethOn).toBe(true);
  });

  it("ignores an invalid choro value", () => {
    expect(parseLayerParams(sp({ choro: "yes" })).choroplethOn).toBeUndefined();
  });

  it("decodes a valid heatmap resolution", () => {
    expect(parseLayerParams(sp({ hres: "raw" })).heatmapResolution).toBe("raw");
  });

  it("ignores an invalid heatmap resolution", () => {
    expect(parseLayerParams(sp({ hres: "ultra" })).heatmapResolution).toBeUndefined();
  });

  it("decodes heatmap=statewide", () => {
    expect(parseLayerParams(sp({ heatmap: "statewide" })))
      .toMatchObject({ heatmapStatewide: true, heatmapCounty: false });
  });

  it("decodes heatmap=off", () => {
    expect(parseLayerParams(sp({ heatmap: "off" })))
      .toMatchObject({ heatmapStatewide: false, heatmapCounty: false });
  });

  it("decodes heatmap=county", () => {
    expect(parseLayerParams(sp({ heatmap: "county" })))
      .toMatchObject({ heatmapStatewide: false, heatmapCounty: true });
  });

  it("ignores an unknown heatmap mode", () => {
    expect(parseLayerParams(sp({ heatmap: "sky" })).heatmapStatewide).toBeUndefined();
  });

  it("decodes several params together", () => {
    expect(parseLayerParams(sp({ palette: "warm", choro: "0", hres: "high" })))
      .toEqual({ palette: "warm", choroplethOn: false, heatmapResolution: "high" });
  });
});

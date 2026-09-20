import { describe, it, expect } from "vitest";
import {
  resolutionForZoom,
  heatmapMaxZoom,
  heatPointBudget,
  HEAT_POINT_BUDGET_TOUCH,
  HEAT_POINT_BUDGET_DESKTOP,
} from "./heatmapLod";

describe("resolutionForZoom", () => {
  it("keeps the requested resolution while it is still useful", () => {
    expect(resolutionForZoom("low", 6, true)).toBe("low");
    expect(resolutionForZoom("low", 8, true)).toBe("low");
  });

  it("steps to the next finer resolution instead of blocking the zoom", () => {
    expect(resolutionForZoom("low", 9, true)).toBe("medium");
    expect(resolutionForZoom("low", 10, true)).toBe("high");
    expect(resolutionForZoom("low", 11, true)).toBe("raw");
    expect(resolutionForZoom("low", 17, true)).toBe("raw");
  });

  it("stops at medium when nothing scopes the query (the API rejects high/raw)", () => {
    expect(resolutionForZoom("low", 9, false)).toBe("medium");
    expect(resolutionForZoom("low", 15, false)).toBe("medium");
  });

  it("never goes coarser than the resolution the user picked", () => {
    expect(resolutionForZoom("medium", 5, true)).toBe("medium");
    expect(resolutionForZoom("high", 5, true)).toBe("high");
  });

  it("falls back to the coarsest rung when the scope cannot serve the request", () => {
    // ?hres=high with no county filter: start at low, let zoom pull it finer.
    expect(resolutionForZoom("high", 5, false)).toBe("low");
    expect(resolutionForZoom("raw", 9, false)).toBe("medium");
  });

  it("reaches raw before the dot threshold so dots always have data", () => {
    expect(resolutionForZoom("low", 13, true)).toBe("raw");
  });
});

describe("heatmapMaxZoom", () => {
  it("lets a scoped selection zoom all the way in", () => {
    expect(heatmapMaxZoom(true)).toBe(18);
  });

  it("caps an unscoped selection where the finest statewide grid runs out", () => {
    expect(heatmapMaxZoom(false)).toBe(9);
  });
});

describe("heatPointBudget", () => {
  it("asks a phone for fewer points than a desktop", () => {
    expect(heatPointBudget(true)).toBe(HEAT_POINT_BUDGET_TOUCH);
    expect(heatPointBudget(false)).toBe(HEAT_POINT_BUDGET_DESKTOP);
    expect(HEAT_POINT_BUDGET_TOUCH).toBeLessThan(HEAT_POINT_BUDGET_DESKTOP);
  });
});

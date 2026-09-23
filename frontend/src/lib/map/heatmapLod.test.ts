import { describe, it, expect } from "vitest";
import {
  resolutionForZoom,
  heatmapMaxZoom,
  heatPointBudget,
  HEAT_POINT_BUDGET_TOUCH,
  HEAT_POINT_BUDGET_DESKTOP,
  nextDotFetch,
  heatOpacityForZoom,
  DOT_MIN_ZOOM,
  type Bbox,
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

describe("heatOpacityForZoom", () => {
  it("is full until one zoom before the dots, then fades and stays low under them", () => {
    expect(DOT_MIN_ZOOM).toBe(13);
    expect(heatOpacityForZoom(7)).toBe(1);
    expect(heatOpacityForZoom(11)).toBe(1);
    expect(heatOpacityForZoom(12)).toBeLessThan(1);
    expect(heatOpacityForZoom(13)).toBeLessThan(heatOpacityForZoom(12));
    expect(heatOpacityForZoom(18)).toBe(heatOpacityForZoom(13));
    // Fractional zooms (pinch) land on the rung below.
    expect(heatOpacityForZoom(12.5)).toBe(heatOpacityForZoom(12));
  });
});

describe("nextDotFetch", () => {
  const view: Bbox = [-119.8, 36.7, -119.76, 36.78];

  it("fetches half a screen beyond the view on every side", () => {
    expect(nextDotFetch(null, view, 15)).toEqual({ bbox: [-119.82, 36.66, -119.74, 36.82], zoom: 15 });
  });

  it("returns the same request while the camera stays inside it", () => {
    // The pan that centres a tapped dot's popup: a fraction of a screen. A new
    // rectangle here refetched the dots and closed the popup just opened.
    const fetched = nextDotFetch(null, view, 15);
    const nudged: Bbox = [-119.79, 36.72, -119.75, 36.8];
    expect(nextDotFetch(fetched, nudged, 15)).toBe(fetched);
  });

  it("refetches once the view crosses the fetched edge", () => {
    const fetched = nextDotFetch(null, view, 15);
    const away: Bbox = [-119.75, 36.7, -119.71, 36.78];
    const next = nextDotFetch(fetched, away, 15);
    expect(next).not.toBe(fetched);
    expect(next.bbox[2]).toBeGreaterThan(fetched.bbox[2]);
  });

  it("refetches on a zoom change even inside the rectangle", () => {
    // The API caps the count, so dots sampled for a wide view are too sparse
    // for a closer one.
    const fetched = nextDotFetch(null, view, 15);
    const closer: Bbox = [-119.79, 36.73, -119.77, 36.75];
    expect(nextDotFetch(fetched, closer, 16)).not.toBe(fetched);
  });

  it("is pure: running it twice on the same input gives the same answer", () => {
    // React StrictMode runs state updaters twice. Zooming in from a wide view
    // must produce the new rectangle on both runs, not the stale wide one.
    const wide = nextDotFetch(null, [-123, 33, -117, 40], 7);
    expect(nextDotFetch(wide, view, 15)).toEqual(nextDotFetch(wide, view, 15));
    expect(nextDotFetch(wide, view, 15).zoom).toBe(15);
  });
});

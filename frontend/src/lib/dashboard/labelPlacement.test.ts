import { describe, it, expect } from "vitest";
import {
  estimateTextBBox,
  rectsOverlap,
  rectInBounds,
  greedyPlace,
  forceDirectedPlacement,
  getBreakpoint,
  getMaxLabels,
  getResponsiveFontSize,
  computeBarLabels,
  computeDonutLabels,
  computeLineLabels,
  computeScatterLabels,
  computeTreemapLabels,
  computeLollipopLabels,
  generateChartAriaLabel,
} from "./labelPlacement";

describe("estimateTextBBox", () => {
  it("estimates a centered label bbox", () => {
    const bbox = estimateTextBBox("Hello", 10, 50, 50, "middle");
    expect(bbox.width).toBeCloseTo(5 * 10 * 0.58, 0);
    expect(bbox.x).toBeCloseTo(50 - bbox.width / 2, 0);
    expect(bbox.height).toBeCloseTo(12, 0);
  });

  it("handles start anchor", () => {
    const bbox = estimateTextBBox("AB", 12, 10, 20, "start");
    expect(bbox.x).toBe(10);
  });

  it("handles end anchor", () => {
    const bbox = estimateTextBBox("AB", 12, 100, 20, "end");
    expect(bbox.x).toBeCloseTo(100 - 2 * 12 * 0.58, 0);
  });
});

describe("rectsOverlap", () => {
  it("detects overlapping rectangles", () => {
    const a = { x: 0, y: 0, width: 50, height: 20 };
    const b = { x: 40, y: 10, width: 50, height: 20 };
    expect(rectsOverlap(a, b, 0)).toBe(true);
  });

  it("detects non-overlapping rectangles", () => {
    const a = { x: 0, y: 0, width: 20, height: 20 };
    const b = { x: 100, y: 100, width: 20, height: 20 };
    expect(rectsOverlap(a, b, 0)).toBe(false);
  });

  it("respects margin", () => {
    const a = { x: 0, y: 0, width: 20, height: 20 };
    const b = { x: 21, y: 0, width: 20, height: 20 };
    expect(rectsOverlap(a, b, 0)).toBe(false);
    expect(rectsOverlap(a, b, 2)).toBe(true);
  });
});

describe("rectInBounds", () => {
  it("returns true for rect inside bounds", () => {
    const r = { x: 10, y: 10, width: 20, height: 20 };
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectInBounds(r, bounds)).toBe(true);
  });

  it("returns false for rect partially outside", () => {
    const r = { x: 90, y: 10, width: 20, height: 20 };
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectInBounds(r, bounds)).toBe(false);
  });
});

describe("greedyPlace", () => {
  it("places non-overlapping labels", () => {
    const candidates = [
      { id: "a", text: "A", anchorX: 10, anchorY: 10, bbox: { x: 0, y: 0, width: 20, height: 10 }, priority: 0, visible: false, fontSize: 10 },
      { id: "b", text: "B", anchorX: 50, anchorY: 10, bbox: { x: 40, y: 0, width: 20, height: 10 }, priority: 1, visible: false, fontSize: 10 },
    ];
    const bounds = { x: 0, y: 0, width: 200, height: 100 };
    const result = greedyPlace(candidates, bounds);
    expect(result.every((r) => r.visible)).toBe(true);
  });

  it("hides overlapping lower-priority labels", () => {
    const candidates = [
      { id: "a", text: "A", anchorX: 10, anchorY: 10, bbox: { x: 0, y: 0, width: 50, height: 10 }, priority: 0, visible: false, fontSize: 10 },
      { id: "b", text: "B", anchorX: 20, anchorY: 10, bbox: { x: 10, y: 0, width: 50, height: 10 }, priority: 1, visible: false, fontSize: 10 },
    ];
    const bounds = { x: 0, y: 0, width: 200, height: 100 };
    const result = greedyPlace(candidates, bounds);
    const a = result.find((r) => r.id === "a")!;
    const b = result.find((r) => r.id === "b")!;
    expect(a.visible).toBe(true);
    expect(b.visible).toBe(false);
  });
});

describe("forceDirectedPlacement", () => {
  it("separates overlapping labels", () => {
    const labels = [
      { id: "a", text: "A", anchorX: 50, anchorY: 50, x: 50, y: 50, width: 40, height: 12, fontSize: 10, priority: 0 },
      { id: "b", text: "B", anchorX: 55, anchorY: 50, x: 55, y: 50, width: 40, height: 12, fontSize: 10, priority: 1 },
    ];
    const bounds = { x: 0, y: 0, width: 300, height: 200 };
    const result = forceDirectedPlacement(labels, bounds);
    const distBefore = Math.abs(labels[0].x - labels[1].x);
    const distAfter = Math.abs(result[0].x - result[1].x);
    expect(distAfter).toBeGreaterThan(distBefore);
  });

  it("keeps labels within bounds", () => {
    const labels = [
      { id: "a", text: "A", anchorX: 5, anchorY: 5, x: 5, y: 5, width: 40, height: 12, fontSize: 10, priority: 0 },
    ];
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    const result = forceDirectedPlacement(labels, bounds);
    expect(result[0].x - result[0].width / 2).toBeGreaterThanOrEqual(0);
    expect(result[0].y - result[0].height / 2).toBeGreaterThanOrEqual(0);
  });
});

describe("responsive utilities", () => {
  it("getBreakpoint returns correct values", () => {
    expect(getBreakpoint(300)).toBe("mobile");
    expect(getBreakpoint(500)).toBe("tablet");
    expect(getBreakpoint(800)).toBe("desktop");
  });

  it("getMaxLabels reduces count on mobile", () => {
    const desktop = getMaxLabels(800, 20, "bar");
    const mobile = getMaxLabels(300, 20, "bar");
    expect(mobile).toBeLessThan(desktop);
  });

  it("getResponsiveFontSize scales with width", () => {
    const large = getResponsiveFontSize(800);
    const small = getResponsiveFontSize(250);
    expect(small).toBeLessThan(large);
    expect(small).toBeGreaterThanOrEqual(7);
  });
});

describe("computeBarLabels", () => {
  it("shows all labels when they fit", () => {
    const labels = ["A", "B", "C"];
    const result = computeBarLabels(labels, 600, 100);
    expect(result.every((r) => r.visible)).toBe(true);
    expect(result.every((r) => !r.rotated)).toBe(true);
  });

  it("rotates labels when dense", () => {
    const labels = Array.from({ length: 20 }, (_, i) => `Category ${i}`);
    const result = computeBarLabels(labels, 400, 20);
    // With 20px slots for long labels, should abbreviate
    expect(result.some((r) => r.truncated || r.rotated)).toBe(true);
  });

  it("hides some labels on small charts", () => {
    const labels = Array.from({ length: 30 }, (_, i) => `Item ${i}`);
    const result = computeBarLabels(labels, 200, 7);
    const visible = result.filter((r) => r.visible);
    expect(visible.length).toBeLessThan(labels.length);
  });
});

describe("computeDonutLabels", () => {
  it("uses inline for large segments and leader for medium", () => {
    const segments = [
      { label: "Big", value: 60, midAngle: 90 },
      { label: "Medium", value: 15, midAngle: 200 },
      { label: "Small", value: 5, midAngle: 300 },
      { label: "Tiny", value: 2, midAngle: 340 },
    ];
    const result = computeDonutLabels(segments, 80, 80, 72, 82, 600);
    const big = result[0];
    const tiny = result[3];
    expect(big.visible).toBe(true);
    expect(tiny.visible).toBe(false); // < 4% hidden
  });
});

describe("computeLineLabels", () => {
  it("labels peaks and valleys", () => {
    const values = [10, 30, 20, 50, 15, 40];
    const points = values.map((_, i) => ({ x: i * 60, y: 100 - values[i] }));
    const format = (v: number) => String(v);
    const result = computeLineLabels(values, points, 400, format);
    const peaks = result.filter((r) => r.type === "peak" && r.visible);
    const valleys = result.filter((r) => r.type === "valley" && r.visible);
    expect(peaks.length).toBeGreaterThan(0);
    expect(valleys.length).toBeGreaterThan(0);
  });

  it("always includes first and last", () => {
    const values = [5, 10, 15, 20, 25];
    const points = values.map((_, i) => ({ x: i * 50, y: 100 - values[i] }));
    const format = (v: number) => String(v);
    const result = computeLineLabels(values, points, 300, format);
    const first = result.find((r) => r.type === "first");
    const last = result.find((r) => r.type === "last");
    expect(first?.visible).toBe(true);
    expect(last?.visible).toBe(true);
  });
});

describe("computeScatterLabels", () => {
  it("places some labels visible", () => {
    const data = Array.from({ length: 8 }, (_, i) => ({
      label: `Point ${i}`,
      px: 50 + i * 40,
      py: 50 + (i % 3) * 30,
      radius: 5,
    }));
    const bounds = { x: 0, y: 0, width: 400, height: 200 };
    const result = computeScatterLabels(data, bounds, 400);
    const visible = result.filter((r) => r.visible);
    expect(visible.length).toBeGreaterThan(0);
  });
});

describe("computeTreemapLabels", () => {
  it("hides labels in tiny cells", () => {
    const cells = [
      { x: 0, y: 0, w: 200, h: 100, label: "Big Cell", pct: 80 },
      { x: 0, y: 100, w: 15, h: 10, label: "Tiny", pct: 2 },
    ];
    const result = computeTreemapLabels(cells, 400);
    expect(result[0].showName).toBe(true);
    expect(result[1].showName).toBe(false);
  });

  it("scales font with cell size", () => {
    const cells = [
      { x: 0, y: 0, w: 300, h: 200, label: "Huge", pct: 70 },
      { x: 0, y: 200, w: 60, h: 40, label: "Small", pct: 10 },
    ];
    const result = computeTreemapLabels(cells, 400);
    expect(result[0].fontSize).toBeGreaterThan(result[1].fontSize);
  });
});

describe("computeLollipopLabels", () => {
  it("truncates long labels", () => {
    const data = [
      { label: "Very Long Category Name Here", value: 100, barEndX: 200, y: 20 },
    ];
    const result = computeLollipopLabels(data, 80, 400, (v) => String(v));
    expect(result[0].truncatedLabel.length).toBeLessThan(data[0].label.length);
    expect(result[0].truncatedLabel.endsWith("…")).toBe(true);
  });

  it("places value right when space available", () => {
    const data = [
      { label: "Cat", value: 50, barEndX: 150, y: 20 },
    ];
    const result = computeLollipopLabels(data, 80, 400, (v) => String(v));
    expect(result[0].valuePlacement).toBe("right");
  });

  it("places value left when near edge", () => {
    const data = [
      { label: "Cat", value: 999, barEndX: 390, y: 20 },
    ];
    const result = computeLollipopLabels(data, 80, 400, (v) => String(v));
    expect(result[0].valuePlacement).toBe("left");
  });
});

describe("generateChartAriaLabel", () => {
  it("produces accessible summary", () => {
    const result = generateChartAriaLabel("bar", "Crashes by Year", [
      { label: "2020", value: 100 },
      { label: "2021", value: 150 },
    ]);
    expect(result).toContain("bar chart");
    expect(result).toContain("Crashes by Year");
    expect(result).toContain("2 data points");
    expect(result).toContain("2020: 100");
  });
});

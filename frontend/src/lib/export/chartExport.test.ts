import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exportChartPng } from "./chartExport";
import { CAPTION_ATTRIBUTION } from "./chartCaption";

/**
 * jsdom has no real canvas/Image pipeline, so the whole rasterization path is
 * mocked: canvas via a fake element, Image firing onload on src assignment,
 * and object URLs stubbed. This exercises the SVG → PNG flow end to end:
 * sizing (min-width + devicePixelRatio), white background, blob download,
 * and the caption block (title/filters/footnotes/attribution) drawn under
 * the chart image.
 *
 * measureText is faked as 7px/char — deterministic and good enough to reason
 * about wrapping without a real font metrics engine.
 */

interface FakeCtx {
  fillStyle: string;
  font: string;
  textBaseline: string;
  fillRect: ReturnType<typeof vi.fn>;
  scale: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  measureText: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
}

describe("exportChartPng", () => {
  let fakeCtx: FakeCtx;
  let fillStyleHistory: string[];
  let toBlob: ReturnType<typeof vi.fn>;
  let fakeCanvas: { width: number; height: number; getContext: () => FakeCtx; toBlob: typeof toBlob };
  let anchors: HTMLAnchorElement[];
  let svg: SVGSVGElement;

  beforeEach(() => {
    fillStyleHistory = [];
    fakeCtx = {
      font: "",
      textBaseline: "",
      fillRect: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
      measureText: vi.fn((text: string) => ({ width: text.length * 7 })),
      fillText: vi.fn(),
    } as unknown as FakeCtx;
    // fillStyle is set repeatedly (white background, then once per caption
    // line's color) — track every value written instead of just the last.
    Object.defineProperty(fakeCtx, "fillStyle", {
      get: () => fillStyleHistory[fillStyleHistory.length - 1],
      set: (v: string) => { fillStyleHistory.push(v); },
    });
    toBlob = vi.fn((cb: (b: Blob | null) => void) => cb(new Blob(["png"], { type: "image/png" })));
    fakeCanvas = { width: 0, height: 0, getContext: () => fakeCtx, toBlob };

    anchors = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      if (tag === "canvas") return fakeCanvas as unknown as HTMLCanvasElement;
      const el = origCreate(tag);
      if (tag === "a") anchors.push(el as HTMLAnchorElement);
      return el;
    }) as typeof document.createElement);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    vi.stubGlobal("Image", class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    });
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });

    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    svg.setAttribute("width", "300");
    svg.setAttribute("height", "150");
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      width: 300, height: 150, top: 0, left: 0, right: 300, bottom: 150, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders onto a devicePixelRatio-scaled canvas with a white background", async () => {
    await exportChartPng(svg, "Crashes by Year");

    // 300px chart is upscaled to the 600px export floor (scale 2), then ×2 dpr.
    // Height also carries the caption block: title (18) + attribution (14)
    // line heights + 10px top/bottom padding = 52, so 300+52=352, ×2 dpr=704.
    expect(fakeCanvas.width).toBe(1200);
    expect(fakeCanvas.height).toBe(704);
    expect(fillStyleHistory[0]).toBe("#ffffff");
    expect(fakeCtx.fillRect).toHaveBeenCalledWith(0, 0, 1200, 704);
    expect(fakeCtx.scale).toHaveBeenCalledWith(2, 2);
    expect(fakeCtx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 600, 300);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png");
  });

  it("names the download after the chart title with a date stamp", async () => {
    await exportChartPng(svg, "Crashes by Year");

    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toMatch(/^crashes_by_year_\d{4}-\d{2}-\d{2}\.png$/);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });

  it("renders at 3x for print quality", async () => {
    await exportChartPng(svg, "Print Me", { printQuality: true });

    expect(fakeCanvas.width).toBe(1800);
    expect(fakeCanvas.height).toBe(1056); // (300 + 52) × 3
    expect(anchors[0].download).toMatch(/_print\.png$/);
  });

  it("rejects when the canvas cannot produce a blob", async () => {
    toBlob.mockImplementation((cb: (b: Blob | null) => void) => cb(null));
    await expect(exportChartPng(svg, "Broken")).rejects.toThrow(/toBlob/);
  });

  it("rejects when the SVG image fails to load", async () => {
    vi.stubGlobal("Image", class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    });
    await expect(exportChartPng(svg, "Broken")).rejects.toThrow(/Failed to load SVG/);
  });

  describe("caption", () => {
    it("draws only the title and attribution lines when there are no filters or footnotes", async () => {
      await exportChartPng(svg, "Crashes by Year");

      const texts = fakeCtx.fillText.mock.calls.map((c) => c[0]);
      expect(texts).toEqual(["Crashes by Year", CAPTION_ATTRIBUTION]);
    });

    it("draws the filter summary and footnote(s) between the title and attribution, in order", async () => {
      await exportChartPng(svg, "People by Mode of Travel*", {
        filterSummary: "Fresno County · 2019–2024",
        footnotes: ["Mode data starts in 2016."],
      });

      const texts = fakeCtx.fillText.mock.calls.map((c) => c[0]);
      expect(texts).toEqual([
        "People by Mode of Travel*",
        "Fresno County · 2019–2024",
        "Mode data starts in 2016.",
        CAPTION_ATTRIBUTION,
      ]);
    });

    it("omits the filter-summary line when none is passed, and skips falsy footnotes", async () => {
      await exportChartPng(svg, "Crashes by Year", { filterSummary: null, footnotes: [null, undefined] });

      const texts = fakeCtx.fillText.mock.calls.map((c) => c[0]);
      expect(texts).toEqual(["Crashes by Year", CAPTION_ATTRIBUTION]);
    });

    it("wraps a long line across multiple fillText calls and grows the canvas to fit", async () => {
      const longFootnote =
        "Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey";
      await exportChartPng(svg, "Crashes by Year", { footnotes: [longFootnote] });

      // Baseline (no footnote) height is 704 at dpr 2 — a wrapped multi-line
      // footnote must push the canvas taller than that.
      expect(fakeCanvas.height).toBeGreaterThan(704);

      const texts = fakeCtx.fillText.mock.calls.map((c) => c[0] as string);
      expect(texts[0]).toBe("Crashes by Year");
      expect(texts[texts.length - 1]).toBe(CAPTION_ATTRIBUTION);
      // More than 2 lines drawn means the footnote actually wrapped.
      expect(texts.length).toBeGreaterThan(3);
      // Re-joining the wrapped fragments recovers the original text exactly —
      // nothing was dropped or duplicated by the wrap.
      expect(texts.slice(1, -1).join(" ")).toBe(longFootnote);
    });

    it("keeps the attribution line last even with a filter summary and multiple footnotes", async () => {
      await exportChartPng(svg, "Crashes by Year", {
        filterSummary: "2019–2024 · Fatal and severe injury · Fresno County",
        footnotes: ["Note one.", "Note two."],
      });

      const calls = fakeCtx.fillText.mock.calls.map((c) => c[0]);
      expect(calls[calls.length - 1]).toBe(CAPTION_ATTRIBUTION);
      expect(calls).toEqual([
        "Crashes by Year",
        "2019–2024 · Fatal and severe injury · Fresno County",
        "Note one.",
        "Note two.",
        CAPTION_ATTRIBUTION,
      ]);
    });
  });
});

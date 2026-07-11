import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exportChartPng } from "./chartExport";

/**
 * jsdom has no real canvas/Image pipeline, so the whole rasterization path is
 * mocked: canvas via a fake element, Image firing onload on src assignment,
 * and object URLs stubbed. This exercises the SVG → PNG flow end to end:
 * sizing (min-width + devicePixelRatio), white background, blob download.
 */

interface FakeCtx {
  fillStyle: string;
  fillRect: ReturnType<typeof vi.fn>;
  scale: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
}

describe("exportChartPng", () => {
  let fakeCtx: FakeCtx;
  let toBlob: ReturnType<typeof vi.fn>;
  let fakeCanvas: { width: number; height: number; getContext: () => FakeCtx; toBlob: typeof toBlob };
  let anchors: HTMLAnchorElement[];
  let svg: SVGSVGElement;

  beforeEach(() => {
    fakeCtx = { fillStyle: "", fillRect: vi.fn(), scale: vi.fn(), drawImage: vi.fn() };
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
    expect(fakeCanvas.width).toBe(1200);
    expect(fakeCanvas.height).toBe(600);
    expect(fakeCtx.fillStyle).toBe("#ffffff");
    expect(fakeCtx.fillRect).toHaveBeenCalledWith(0, 0, 1200, 600);
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
    expect(fakeCanvas.height).toBe(900);
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
});

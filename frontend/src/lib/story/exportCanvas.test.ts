import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("html-to-image");
vi.mock("jspdf");

import { defaultFilename, exportPng, exportPdf } from "./exportCanvas";
import * as htmlToImageModule from "html-to-image";
import { jsPDF as jsPDFConstructor } from "jspdf";

const mockToPng = vi.fn(async () => "data:image/png;base64,AAAA");

/** Read the options object passed to the most recent toPng call. The mock's
 * inferred signature has no params, so index past the tuple type via a cast. */
function lastToPngStyle(): Record<string, string> | undefined {
  const call = mockToPng.mock.calls[0] as unknown as [unknown, { style?: Record<string, string> }?];
  return call[1]?.style;
}
const mockSave = vi.fn();
const mockAddImage = vi.fn();
const mockAddPage = vi.fn();

const mockPdfInstance = {
  internal: { pageSize: { getWidth: () => 100, getHeight: () => 200 } },
  addImage: mockAddImage,
  addPage: mockAddPage,
  save: mockSave,
};

// Setup html-to-image mock
Object.assign(htmlToImageModule, { toPng: mockToPng });

// Setup jsPDF mock - use vi.mocked to get the mocked constructor
const MockedJsPDF = vi.mocked(jsPDFConstructor);
MockedJsPDF.mockImplementation(function() { return mockPdfInstance; });

function fakeNode(): HTMLElement {
  const el = document.createElement("div");
  // jsdom returns 0s for layout; override so PDF math is finite
  el.getBoundingClientRect = () => ({ width: 100, height: 150, top: 0, left: 0, right: 100, bottom: 150, x: 0, y: 0, toJSON: () => ({}) });
  return el;
}

beforeEach(() => { MockedJsPDF.mockClear(); mockToPng.mockClear(); mockSave.mockClear(); mockAddImage.mockClear(); mockAddPage.mockClear(); });

describe("exportCanvas", () => {
  it("builds a dated filename", () => {
    expect(defaultFilename(new Date("2026-06-28T12:00:00Z"))).toBe("calsight-story-2026-06-28");
  });

  it("exportPng rasterizes the node and triggers a .png download", async () => {
    const node = fakeNode();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await exportPng(node, "calsight-story-2026-06-28");
    expect(mockToPng).toHaveBeenCalledWith(node, expect.objectContaining({ pixelRatio: 2 }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  // Regression guard for the blank-export bug (PR #332): the capture target is
  // rendered off-screen (position:fixed; left:-9999px). html-to-image clones the
  // node and KEEPS that offset, painting the content off-canvas → a blank PNG.
  // The fix neutralizes position/left/top on the CLONE via the `style` option.
  // The original mocked tests passed while the real export was blank because the
  // mock ignored these options entirely — so we assert the override explicitly.
  it("neutralizes the off-screen offset on the export clone (anti-blank-image guard)", async () => {
    await exportPng(fakeNode(), "x");
    expect(lastToPngStyle()).toMatchObject({ position: "static", left: "0", top: "0" });
  });

  it("exportPdf also neutralizes the off-screen offset on the export clone", async () => {
    await exportPdf(fakeNode(), "x");
    expect(lastToPngStyle()).toMatchObject({ position: "static", left: "0", top: "0" });
  });

  it("exportPdf rasterizes the node and saves a .pdf", async () => {
    const node = fakeNode();
    await exportPdf(node, "calsight-story-2026-06-28");
    expect(mockToPng).toHaveBeenCalledWith(node, expect.objectContaining({ pixelRatio: 2 }));
    expect(mockAddImage).toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalledWith("calsight-story-2026-06-28.pdf");
  });

  it("exportPdf handles multi-page pagination for tall nodes", async () => {
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ width: 100, height: 400, top: 0, left: 0, right: 100, bottom: 400, x: 0, y: 0, toJSON: () => ({}) });
    await exportPdf(el, "calsight-story-tall");
    expect(mockAddPage).toHaveBeenCalled();
    expect(mockAddImage.mock.calls.length).toBeGreaterThan(1);
    expect(mockSave).toHaveBeenCalledWith("calsight-story-tall.pdf");
  });
});

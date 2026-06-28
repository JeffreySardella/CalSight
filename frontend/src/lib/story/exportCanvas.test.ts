import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("html-to-image");
vi.mock("jspdf");

import { defaultFilename, exportPng, exportPdf } from "./exportCanvas";
import * as htmlToImageModule from "html-to-image";
import { jsPDF as jsPDFConstructor } from "jspdf";

const mockToPng = vi.fn(async () => "data:image/png;base64,AAAA");
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

beforeEach(() => { mockToPng.mockClear(); mockSave.mockClear(); mockAddImage.mockClear(); mockAddPage.mockClear(); });

describe("exportCanvas", () => {
  it("builds a dated filename", () => {
    expect(defaultFilename(new Date("2026-06-28T12:00:00Z"))).toBe("calsight-story-2026-06-28");
  });

  it("exportPng rasterizes the node and triggers a .png download", async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await exportPng(fakeNode(), "calsight-story-2026-06-28");
    expect(mockToPng).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it("exportPdf rasterizes the node and saves a .pdf", async () => {
    await exportPdf(fakeNode(), "calsight-story-2026-06-28");
    expect(mockToPng).toHaveBeenCalledTimes(1);
    expect(mockAddImage).toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalledWith("calsight-story-2026-06-28.pdf");
  });
});

/**
 * Chart-level export utilities — PNG snapshot of an SVG chart element, and
 * lightweight CSV export of a chart's data array.
 */

import { triggerDownload, todayStamp } from "./download";

// ---------------------------------------------------------------------------
// PNG export
// ---------------------------------------------------------------------------

/**
 * Resolves CSS custom-property references like `rgb(var(--primary))` to their
 * actual computed values so the SVG renders correctly when drawn off-screen
 * (outside the DOM where CSS vars aren't available).
 */
function resolveVarColors(svgString: string): string {
  const style = getComputedStyle(document.documentElement);
  return svgString.replace(/rgb\(var\(--([^)]+)\)\)/g, (_match, token: string) => {
    const raw = style.getPropertyValue(`--${token}`).trim();
    if (!raw) return "rgb(0,0,0)";
    // Our tokens store space-separated R G B values (e.g. "98 0 238") — wrap
    // them with rgb() so the serialized SVG is valid standalone.
    return `rgb(${raw})`;
  });
}

/**
 * Export an SVG element as a retina-quality PNG.
 *
 * Approach: serialize the SVG with resolved CSS vars, load as an Image onto a
 * 2x canvas with a white background, then trigger download.
 */
export async function exportChartPng(svgEl: SVGSVGElement, title: string): Promise<void> {
  const serializer = new XMLSerializer();
  let svgString = serializer.serializeToString(svgEl);
  svgString = resolveVarColors(svgString);

  // Ensure the SVG has explicit width/height for the canvas draw.
  const rect = svgEl.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;

  // Inject xmlns if missing (XMLSerializer usually includes it, but just in case).
  if (!svgString.includes("xmlns")) {
    svgString = svgString.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement("canvas");
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d")!;

  // White background so transparent areas don't export as black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(dpr, dpr);

  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  return new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) {
          reject(new Error("Canvas toBlob returned null"));
          return;
        }
        const filename = `${slugify(title)}_${todayStamp()}.png`;
        triggerDownload(pngBlob, filename);
        resolve();
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load SVG as image for PNG export"));
    };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

export interface ChartCsvRow {
  label: string;
  value: number;
  x?: number;
  y?: number;
}

/**
 * Export a chart's data array as a CSV file download.
 */
export function exportChartCsv(data: ChartCsvRow[], title: string, isScatter = false): void {
  const headers = isScatter ? ["Label", "X", "Y"] : ["Label", "Value"];
  const rows = data.map((d) =>
    isScatter
      ? [csvEscape(d.label), csvEscape(d.x ?? 0), csvEscape(d.y ?? 0)]
      : [csvEscape(d.label), csvEscape(d.value)]
  );
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");

  // UTF-8 BOM so Excel opens with correct encoding.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const filename = `${slugify(title)}_${todayStamp()}.csv`;
  triggerDownload(blob, filename);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function slugify(text: string): string {
  return text.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
}

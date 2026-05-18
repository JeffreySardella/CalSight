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
 * scaled canvas with a white background, then trigger download.
 *
 * @param svgEl  - The SVG element to export
 * @param title  - Used for the filename
 * @param options - Optional settings:
 *   - printQuality: when true, renders at 3x (300 DPI equivalent at 100% zoom)
 *     instead of the default 2x (retina). Use for print-ready exports.
 */
export async function exportChartPng(
  svgEl: SVGSVGElement,
  title: string,
  options?: { printQuality?: boolean },
): Promise<void> {
  const serializer = new XMLSerializer();
  let svgString = serializer.serializeToString(svgEl);
  svgString = resolveVarColors(svgString);

  // Use a minimum export width so mobile charts don't produce tiny PNGs.
  const rect = svgEl.getBoundingClientRect();
  const MIN_EXPORT_W = 600;
  const w = Math.max(rect.width, MIN_EXPORT_W);
  const scale = w / rect.width;
  const h = rect.height * scale;

  // Inject xmlns if missing (XMLSerializer usually includes it, but just in case).
  if (!svgString.includes("xmlns")) {
    svgString = svgString.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  // Force minimum dimensions in the serialized SVG so it renders at export size
  svgString = svgString
    .replace(/width="[^"]*"/, `width="${w}"`)
    .replace(/height="[^"]*"/, `height="${h}"`);
  if (!svgString.includes('width=')) {
    svgString = svgString.replace('<svg', `<svg width="${w}" height="${h}"`);
  }

  const dpr = options?.printQuality
    ? 3
    : Math.min(window.devicePixelRatio || 1, 2);

  const canvas = document.createElement("canvas");
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d")!;

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
        const filename = `${slugify(title)}_${todayStamp()}${options?.printQuality ? "_print" : ""}.png`;
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

/**
 * Export all SVGs within a container as a single high-DPI composite PNG.
 * Useful for a "print all charts" export that gives users a single image file
 * suitable for embedding in reports at 300 DPI.
 */
export async function exportAllChartsPng(
  container: HTMLElement,
  title: string,
): Promise<void> {
  const svgs = container.querySelectorAll<SVGSVGElement>("svg");
  if (svgs.length === 0) return;

  // Lay out charts vertically with padding
  const padding = 20;
  const dpr = 3; // 300 DPI equivalent
  const measurements = Array.from(svgs).map((svg) => {
    const rect = svg.getBoundingClientRect();
    return { svg, w: rect.width, h: rect.height };
  });

  const maxW = Math.max(...measurements.map((m) => m.w));
  const totalH = measurements.reduce((sum, m) => sum + m.h + padding, 0) - padding;

  const canvas = document.createElement("canvas");
  canvas.width = maxW * dpr;
  canvas.height = totalH * dpr;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(dpr, dpr);

  let offsetY = 0;
  for (const { svg, w, h } of measurements) {
    const serializer = new XMLSerializer();
    let svgString = serializer.serializeToString(svg);
    svgString = resolveVarColors(svgString);
    if (!svgString.includes("xmlns")) {
      svgString = svgString.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, offsetY, w, h);
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(); // Skip failed SVGs
      };
      img.src = url;
    });

    offsetY += h + padding;
  }

  canvas.toBlob((pngBlob) => {
    if (!pngBlob) return;
    const filename = `${slugify(title)}_all_charts_${todayStamp()}.png`;
    triggerDownload(pngBlob, filename);
  }, "image/png");
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

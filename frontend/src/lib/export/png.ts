/**
 * PNG export — snapshots the Leaflet map container as a PNG.
 *
 * Uses `html-to-image` (more reliable than html2canvas for canvas-heavy
 * elements like the heatmap layer). CARTO tiles serve with
 * `access-control-allow-origin: *`, so canvases aren't tainted in modern
 * browsers — the rare failure mode is one specific tile that fails to load
 * before capture, in which case it appears as a gray square. Worst case the
 * caller catches the error and shows a retry message.
 */

import { triggerDownload, todayStamp } from "./download";

const MAP_CONTAINER_SELECTOR = ".leaflet-container";

export interface PngExportOptions {
  /** Suffix added to the filename. */
  filenameSuffix?: string;
}

export class PngExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PngExportError";
  }
}

export async function exportPng(opts: PngExportOptions = {}): Promise<void> {
  const target = document.querySelector(MAP_CONTAINER_SELECTOR) as HTMLElement | null;
  if (!target) {
    throw new PngExportError(
      "Couldn't find the map on the page — make sure you're on the Map tab and try again.",
    );
  }

  // Filter out the zoom control + attribution because they look out of place
  // on a static export. The heatmap canvas + tile layers stay.
  const { toPng } = await import("html-to-image");

  const dataUrl = await toPng(target, {
    cacheBust: true,
    // Retina screens can report DPRs of 3+ but html-to-image renders the
    // heatmap canvas blank above 2 — cap it to keep the export working.
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    filter: (node) => {
      if (!(node instanceof Element)) return true;
      if (node.classList?.contains("leaflet-control-container")) return false;
      return true;
    },
  });

  // Convert data: URL to Blob so triggerDownload can revoke it cleanly.
  const blob = await (await fetch(dataUrl)).blob();
  triggerDownload(blob, `calsight-map_${todayStamp()}${opts.filenameSuffix ?? ""}.png`);
}

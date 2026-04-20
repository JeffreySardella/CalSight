export type PaletteKey = "default" | "warm" | "cool" | "colorblind";

export type PaletteVariants = {
  /** Ordered light → dark (low → high measure value). Tuned for white basemap. */
  light: readonly string[];
  /** Ordered dark/muted → bright (low → high). Tuned for dark basemap — the
   *  pale-end of the light palette vanishes into a black background, so the
   *  dark variants start from a medium-dark base and ramp to a luminous end. */
  dark: readonly string[];
};

// `colorblind` is an Okabe-Ito-derived diverging scale safe for
// deuteranopia/protanopia: orange → pale → blue (light) or brightened versions
// of the same direction for dark mode.
export const PALETTES: Record<PaletteKey, PaletteVariants> = {
  default: {
    light: ["#c7d2fe", "#818cf8", "#6366f1", "#4338ca", "#312e81"],
    dark:  ["#312e81", "#4338ca", "#6366f1", "#a5b4fc", "#e0e7ff"],
  },
  warm: {
    light: ["#fef3c7", "#fcd34d", "#f59e0b", "#dc2626", "#7f1d1d"],
    dark:  ["#7c2d12", "#b45309", "#f59e0b", "#fbbf24", "#fde68a"],
  },
  cool: {
    light: ["#ccfbf1", "#5eead4", "#14b8a6", "#0f766e", "#134e4a"],
    dark:  ["#134e4a", "#0f766e", "#14b8a6", "#5eead4", "#ccfbf1"],
  },
  colorblind: {
    light: ["#e66100", "#f3b678", "#f5f5f5", "#8aaed4", "#5d3a9b"],
    dark:  ["#ff6b00", "#ffb07a", "#e5e5e5", "#a6c1e2", "#b794f6"],
  },
};

/** Return the palette array appropriate for the active theme. */
export function getPalette(key: PaletteKey, isDark: boolean): readonly string[] {
  return isDark ? PALETTES[key].dark : PALETTES[key].light;
}

export const HATCH_PATTERN_ID = "calsight-no-data-hatch";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Mount the SVG <pattern> used by Leaflet paths (fillColor="url(#id)")
 * for rendering counties with insufficient data. Idempotent — safe to
 * call from every component mount.
 *
 * The default palette is theme-neutral (mid-grey on mid-grey), readable on
 * both light and dark basemaps without needing two separate patterns.
 *
 * Uses document.createElementNS — no innerHTML, no parsing — so there is
 * no path for untrusted content to flow into the DOM.
 */
export function installHatchPattern(): void {
  const hostId = `${HATCH_PATTERN_ID}-host`;
  if (document.getElementById(hostId)) return;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("id", hostId);
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";

  const defs = document.createElementNS(SVG_NS, "defs");
  const pattern = document.createElementNS(SVG_NS, "pattern");
  pattern.setAttribute("id", HATCH_PATTERN_ID);
  pattern.setAttribute("width", "6");
  pattern.setAttribute("height", "6");
  pattern.setAttribute("patternUnits", "userSpaceOnUse");
  pattern.setAttribute("patternTransform", "rotate(45)");

  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("width", "6");
  rect.setAttribute("height", "6");
  rect.setAttribute("fill", "#737373");
  rect.setAttribute("fill-opacity", "0.4");

  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("x1", "0");
  line.setAttribute("y1", "0");
  line.setAttribute("x2", "0");
  line.setAttribute("y2", "6");
  line.setAttribute("stroke", "#a3a3a3");
  line.setAttribute("stroke-width", "2");

  pattern.appendChild(rect);
  pattern.appendChild(line);
  defs.appendChild(pattern);
  svg.appendChild(defs);
  document.body.appendChild(svg);
}

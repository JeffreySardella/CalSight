/**
 * Shared "text on colored background" helper for SVG charts.
 *
 * Given the fill color of a chart element (hex string), returns a dark or
 * light text color so labels drawn directly on the shape keep readable
 * contrast on both light slices (e.g. the colorblind palette's yellow) and
 * dark slices. Non-hex inputs (CSS variables, rgb() strings) can't be
 * inspected, so they fall back to white — matching the historical behavior
 * for token-driven fills, which are mid-to-dark in every built-in palette.
 */
export function textOnColor(color: string): string {
  if (!color.startsWith("#") || color.length < 7) return "#ffffff";
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const lum = 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255);
  return lum > 0.4 ? "#1a1a1a" : "#ffffff";
}

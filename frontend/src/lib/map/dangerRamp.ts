import { getPalette, type PaletteKey } from "../choropleth/palettes";

/**
 * The one danger ramp, shared by every overlay that colors things by "how bad
 * is it here" — highway lines and school markers today.
 *
 * It is deliberately separate from the county choropleth palette. Reusing the
 * choropleth colors made highways the same blue as the counties underneath, so
 * they vanished into the shading; this light-orange -> crimson ramp reads on
 * top of any choropleth in either theme and never implies something is "safe".
 */
export const DANGER_COLORS = ["#fdba74", "#f97316", "#dc2626", "#7f1d1d"] as const;

/** Nothing to color: no row, no value, no crashes on file. Gray rather than
 *  the bottom of the ramp, because "we have nothing here" is a different claim
 *  from "this is the safe end of the scale". */
export const DANGER_NO_DATA_COLOR = "#9ca3af";

/**
 * Resolve the ramp for the active palette.
 *
 * The orange -> crimson ramp is the default for every palette except
 * `colorblind`. That one is the accessibility option, and an accessibility
 * option that only reaches the choropleth is not one — a deuteranope reading
 * this ramp sees four browns. So the colorblind selection swaps in the same
 * ColorBrewer Blues ramp the choropleth uses, whose luminance rises
 * monotonically across the scale and therefore survives greyscale too.
 *
 * `slice(1)` drops the low end of that 5-stop palette to reach 4 stops. That
 * end is the one that disappears into the basemap in each theme — near-white
 * on light, near-black on dark — and dropping it keeps the ramp monotonic.
 */
export function dangerColors(palette: PaletteKey, isDark: boolean): readonly string[] {
  if (palette !== "colorblind") return DANGER_COLORS;
  return getPalette("colorblind", isDark).slice(1);
}

/**
 * useChartColors — provides the active chart color palette to chart components.
 *
 * This hook reads from the CustomThemeContext and returns a palette array
 * plus a helper to pick a color by index (cycling through the palette).
 * Charts that want to respect the user's palette preference use this hook
 * instead of hardcoding color arrays.
 */

import { useCallback } from "react";
import { useCustomTheme } from "../context/CustomThemeContext";
import { paletteColor } from "../lib/theme/palettes";

export function useChartColors() {
  const { chartColors } = useCustomTheme();

  /** Pick a color by index, cycling through the active palette */
  const colorAt = useCallback(
    (index: number): string => paletteColor(chartColors, index),
    [chartColors],
  );

  return {
    /** The full ordered palette array */
    palette: chartColors,
    /** Pick color at index (wraps around) */
    colorAt,
    /** Number of unique colors before cycling */
    paletteSize: chartColors.length,
  };
}

/**
 * useDesignTokens — reactive access to the resolved design token set.
 *
 * This hook provides JS-accessible token values for components that cannot
 * use CSS custom properties (e.g. Leaflet map layers that need hex strings).
 *
 * It combines the user's active chart palette with the current light/dark mode
 * to resolve the full DesignTokens object. The result is memoized and only
 * recomputes when the palette or mode changes.
 *
 * Usage:
 *   const tokens = useDesignTokens();
 *   const fatalColor = tokens.severity.fatal;
 *   const palette = tokens.chart.categorical;
 */

import { useMemo } from "react";
import { useCustomTheme } from "../context/CustomThemeContext";
import { useIsDark } from "../context/ThemeContext";
import { getTokens, type DesignTokens } from "../lib/theme/tokens";

/**
 * Returns the full design token set resolved for the current palette and mode.
 *
 * For map-specific tokens (choropleth scale), pass the choropleth palette
 * colors explicitly via the optional parameter. This avoids coupling this
 * hook to the LayersState context (which is only available in the map page).
 */
export function useDesignTokens(choroplethColors?: readonly string[]): DesignTokens {
  const { customization } = useCustomTheme();
  const isDark = useIsDark();

  return useMemo(
    () => getTokens(
      customization.chart.palette,
      isDark,
      customization.chart.customColors,
      choroplethColors,
    ),
    [customization.chart.palette, customization.chart.customColors, isDark, choroplethColors],
  );
}

export type { DesignTokens };

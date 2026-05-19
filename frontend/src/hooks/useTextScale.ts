/**
 * useTextScale — returns a numeric multiplier for font sizes based on
 * the user's typography scale preference (small / default / large).
 *
 * Usage: multiply hardcoded fontSize values by the returned factor.
 * E.g. `fontSize={10 * scale}` makes axis labels respect the setting.
 *
 * This is the runtime companion to the CSS variables emitted by
 * `typeScaleVars()` in cssInjector.ts — those variables drive
 * CSS-based sizing, while this hook drives SVG attribute-based sizing
 * where CSS variables can't be used directly in attributes.
 */

import { useCustomTheme } from "../context/CustomThemeContext";

export function useTextScale(): number {
  const { customization } = useCustomTheme();
  switch (customization.typeScale) {
    case "small":
      return 0.85;
    case "large":
      return 1.2;
    default:
      return 1;
  }
}

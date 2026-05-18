/**
 * Theme customization type definitions.
 *
 * The system layers custom CSS variable overrides on top of the base MD3
 * tokens already defined in index.css. Each preset or user-created theme
 * produces a flat map of CSS custom property values that get applied to
 * :root at runtime. Because Tailwind classes resolve through these same
 * CSS variables, changes propagate instantly to every component.
 */

/** Chart color palette identifiers */
export type ChartPaletteKey =
  | "default"
  | "warm"
  | "cool"
  | "ocean"
  | "forest"
  | "sunset"
  | "colorblind"
  | "monochrome"
  | "custom";

/** Card style variants */
export type CardStyle =
  | "elevated"    // Default: subtle shadow + rounded
  | "minimal"    // No shadow, subtle background only
  | "bordered"   // Explicit border, no shadow
  | "glass";     // Glassmorphism: blur + translucency

/** Density control for chart padding and spacing */
export type Density = "compact" | "comfortable" | "spacious";

/** Typography scale multiplier */
export type TypeScale = "small" | "default" | "large";

/** Named preset themes */
export type PresetThemeKey =
  | "default"
  | "professional"
  | "academic"
  | "playful"
  | "high-contrast"
  | "midnight"
  | "nature";

/** Full customization state persisted to localStorage */
export interface ThemeCustomization {
  /** Which preset is active (or "custom" if user has modified values) */
  activePreset: PresetThemeKey | "custom";

  /** MD3 color overrides — space-separated RGB channels like "87 95 107" */
  colors: {
    primary: string;
    tertiary: string;
    error: string;
    /** Derived containers are auto-calculated from the base colors */
  };

  /** Chart-specific settings */
  chart: {
    palette: ChartPaletteKey;
    /** Custom colors used when palette is "custom" */
    customColors: string[];
  };

  /** Card appearance */
  cardStyle: CardStyle;

  /** Content density */
  density: Density;

  /** Typography scale */
  typeScale: TypeScale;

  /** Arbitrary CSS variable overrides: key is the variable name (without --) */
  customVars: Record<string, string>;
}

/** A complete exportable theme blob */
export interface ExportedTheme {
  name: string;
  version: 1;
  createdAt: string;
  customization: ThemeCustomization;
}

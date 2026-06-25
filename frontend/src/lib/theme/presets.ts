/**
 * Preset theme definitions.
 *
 * Each preset is a complete ThemeCustomization object. The "default" preset
 * matches the existing app styling so applying it is effectively a no-op.
 * Other presets override colors + chart palette + card style to create a
 * distinct personality.
 */

import type { ThemeCustomization, PresetThemeKey } from "./types";
import { PALETTE_SEVERITY } from "./palettes";

function sevToRgb(hex: string): string {
  const h = hex.replace("#", "");
  return `${parseInt(h.slice(0, 2), 16)} ${parseInt(h.slice(2, 4), 16)} ${parseInt(h.slice(4, 6), 16)}`;
}

function sevColors(paletteKey: keyof typeof PALETTE_SEVERITY) {
  const s = PALETTE_SEVERITY[paletteKey];
  return { primary: sevToRgb(s.pdo), tertiary: sevToRgb(s.injury), error: sevToRgb(s.fatal) };
}

/** Default — matches existing MD3 tokens in index.css. Brand `primary` is set
 *  explicitly (indigo-600 #4f46e5) rather than borrowing the lighter PDO chart
 *  swatch, so filled primary buttons meet WCAG 1.4.3 contrast in light mode. */
const DEFAULT_THEME: ThemeCustomization = {
  activePreset: "default",
  colors: { ...sevColors("default"), primary: "79 70 229" },
  chart: {
    palette: "default",
    customColors: [],
  },
  cardStyle: "elevated",
  density: "comfortable",
  typeScale: "default",
  customVars: {},
};

/** Professional — muted navy/slate, bordered cards, clean lines */
const PROFESSIONAL_THEME: ThemeCustomization = {
  activePreset: "professional",
  colors: sevColors("cool"),
  chart: {
    palette: "cool",
    customColors: [],
  },
  cardStyle: "bordered",
  density: "comfortable",
  typeScale: "default",
  customVars: {},
};

/** Academic — deep purple/indigo, minimal cards, spacious */
const ACADEMIC_THEME: ThemeCustomization = {
  activePreset: "academic",
  colors: sevColors("colorblind"),
  chart: {
    palette: "colorblind",
    customColors: [],
  },
  cardStyle: "minimal",
  density: "spacious",
  typeScale: "large",
  customVars: {},
};

/** Playful — vibrant pink/teal, glassmorphism, warm palette */
const PLAYFUL_THEME: ThemeCustomization = {
  activePreset: "playful",
  colors: sevColors("sunset"),
  chart: {
    palette: "sunset",
    customColors: [],
  },
  cardStyle: "glass",
  density: "comfortable",
  typeScale: "default",
  customVars: {},
};

/** High Contrast — maximum readability, stark black/white anchors */
const HIGH_CONTRAST_THEME: ThemeCustomization = {
  activePreset: "high-contrast",
  colors: sevColors("colorblind"),
  chart: {
    palette: "colorblind",
    customColors: [],
  },
  cardStyle: "bordered",
  density: "spacious",
  typeScale: "large",
  customVars: {},
};

/** Midnight — deep navy surfaces, electric accents */
const MIDNIGHT_THEME: ThemeCustomization = {
  activePreset: "midnight",
  colors: sevColors("ocean"),
  chart: {
    palette: "ocean",
    customColors: [],
  },
  cardStyle: "glass",
  density: "comfortable",
  typeScale: "default",
  customVars: {},
};

/** Nature — earth greens and warm browns */
const NATURE_THEME: ThemeCustomization = {
  activePreset: "nature",
  colors: sevColors("forest"),
  chart: {
    palette: "forest",
    customColors: [],
  },
  cardStyle: "elevated",
  density: "comfortable",
  typeScale: "default",
  customVars: {},
};

export const PRESET_THEMES: Record<PresetThemeKey, ThemeCustomization> = {
  default: DEFAULT_THEME,
  professional: PROFESSIONAL_THEME,
  academic: ACADEMIC_THEME,
  playful: PLAYFUL_THEME,
  "high-contrast": HIGH_CONTRAST_THEME,
  midnight: MIDNIGHT_THEME,
  nature: NATURE_THEME,
};

export const PRESET_LABELS: Record<PresetThemeKey, { label: string; description: string }> = {
  default: { label: "Default", description: "Clean Material Design 3 palette" },
  professional: { label: "Professional", description: "Muted navy tones, crisp borders" },
  academic: { label: "Academic", description: "Deep indigo, spacious typography" },
  playful: { label: "Playful", description: "Vibrant gradients, glassmorphism" },
  "high-contrast": { label: "High Contrast", description: "Maximum readability" },
  midnight: { label: "Midnight", description: "Dark navy with electric accents" },
  nature: { label: "Nature", description: "Forest greens and earth tones" },
};

export const PRESET_KEYS = Object.keys(PRESET_THEMES) as PresetThemeKey[];

export function getDefaultCustomization(): ThemeCustomization {
  return structuredClone(DEFAULT_THEME);
}

/**
 * Preset theme definitions.
 *
 * Each preset is a complete ThemeCustomization object. The "default" preset
 * matches the existing app styling so applying it is effectively a no-op.
 * Other presets override colors + chart palette + card style to create a
 * distinct personality.
 */

import type { ThemeCustomization, PresetThemeKey } from "./types";

/** Default — matches existing MD3 tokens in index.css */
const DEFAULT_THEME: ThemeCustomization = {
  activePreset: "default",
  colors: {
    primary: "87 95 107",
    tertiary: "91 93 120",
    error: "159 64 61",
  },
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
  colors: {
    primary: "30 58 95",
    tertiary: "71 85 105",
    error: "185 28 28",
  },
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
  colors: {
    primary: "79 70 229",
    tertiary: "109 40 217",
    error: "190 18 60",
  },
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
  colors: {
    primary: "217 70 239",
    tertiary: "6 182 212",
    error: "244 63 94",
  },
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
  colors: {
    primary: "0 0 0",
    tertiary: "30 64 175",
    error: "185 28 28",
  },
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
  colors: {
    primary: "99 102 241",
    tertiary: "14 165 233",
    error: "251 113 133",
  },
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
  colors: {
    primary: "21 128 61",
    tertiary: "120 113 108",
    error: "194 65 12",
  },
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

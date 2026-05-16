/**
 * CustomThemeContext — manages user theme customization state.
 *
 * This context sits alongside the existing ThemeContext (dark/light/system)
 * and controls the visual customization layer: colors, chart palettes,
 * card styles, density, typography, and arbitrary CSS variable overrides.
 *
 * On mount it loads persisted settings from localStorage and injects the
 * CSS overrides. On any state change it re-injects and persists.
 */

import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import type {
  ThemeCustomization,
  PresetThemeKey,
  ChartPaletteKey,
  CardStyle,
  Density,
  TypeScale,
} from "../lib/theme/types";
import { PRESET_THEMES, getDefaultCustomization } from "../lib/theme/presets";
import { getChartPalette } from "../lib/theme/palettes";
import { injectThemeCss } from "../lib/theme/cssInjector";
import { loadCustomization, saveCustomization, exportTheme, importTheme } from "../lib/theme/persistence";

interface CustomThemeContextValue {
  /** Current full customization state */
  customization: ThemeCustomization;

  /** Apply a named preset (resets all customization to preset values) */
  applyPreset: (key: PresetThemeKey) => void;

  /** Update individual color tokens */
  setColors: (colors: Partial<ThemeCustomization["colors"]>) => void;

  /** Change chart palette */
  setChartPalette: (palette: ChartPaletteKey, customColors?: string[]) => void;

  /** Change card style */
  setCardStyle: (style: CardStyle) => void;

  /** Change density */
  setDensity: (density: Density) => void;

  /** Change typography scale */
  setTypeScale: (scale: TypeScale) => void;

  /** Set arbitrary CSS variable overrides */
  setCustomVars: (vars: Record<string, string>) => void;

  /** Get the current chart palette colors array */
  chartColors: readonly string[];

  /** Export current theme as JSON file download */
  exportCurrentTheme: (name?: string) => void;

  /** Import theme from a file, returns success boolean */
  importThemeFile: (file: File) => Promise<boolean>;

  /** Reset to factory defaults */
  reset: () => void;

  /** Whether the current state differs from the active preset */
  isModified: boolean;
}

const CustomThemeContext = createContext<CustomThemeContextValue | undefined>(undefined);

export function CustomThemeProvider({ children }: { children: React.ReactNode }) {
  const [customization, setCustomization] = useState<ThemeCustomization>(loadCustomization);
  const isFirstRender = useRef(true);

  // Inject CSS on mount and whenever customization changes
  useEffect(() => {
    // Don't inject if using default preset with no modifications
    const isDefault = customization.activePreset === "default" &&
      Object.keys(customization.customVars).length === 0;

    if (isDefault) {
      injectThemeCss(null);
    } else {
      injectThemeCss(customization);
    }
  }, [customization]);

  // Persist to localStorage (debounced to avoid thrashing during rapid changes)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const id = setTimeout(() => saveCustomization(customization), 300);
    return () => clearTimeout(id);
  }, [customization]);

  const applyPreset = useCallback((key: PresetThemeKey) => {
    setCustomization(structuredClone(PRESET_THEMES[key]));
  }, []);

  const setColors = useCallback((colors: Partial<ThemeCustomization["colors"]>) => {
    setCustomization((prev) => ({
      ...prev,
      activePreset: "custom",
      colors: { ...prev.colors, ...colors },
    }));
  }, []);

  const setChartPalette = useCallback((palette: ChartPaletteKey, customColors?: string[]) => {
    setCustomization((prev) => ({
      ...prev,
      activePreset: "custom",
      chart: {
        palette,
        customColors: customColors ?? prev.chart.customColors,
      },
    }));
  }, []);

  const setCardStyle = useCallback((cardStyle: CardStyle) => {
    setCustomization((prev) => ({ ...prev, activePreset: "custom", cardStyle }));
  }, []);

  const setDensity = useCallback((density: Density) => {
    setCustomization((prev) => ({ ...prev, activePreset: "custom", density }));
  }, []);

  const setTypeScale = useCallback((typeScale: TypeScale) => {
    setCustomization((prev) => ({ ...prev, activePreset: "custom", typeScale }));
  }, []);

  const setCustomVars = useCallback((vars: Record<string, string>) => {
    setCustomization((prev) => ({
      ...prev,
      activePreset: "custom",
      customVars: { ...prev.customVars, ...vars },
    }));
  }, []);

  const chartColors = getChartPalette(
    customization.chart.palette,
    customization.chart.customColors,
  );

  const exportCurrentTheme = useCallback((name?: string) => {
    exportTheme(customization, name);
  }, [customization]);

  const importThemeFile = useCallback(async (file: File): Promise<boolean> => {
    const imported = await importTheme(file);
    if (!imported) return false;
    setCustomization(imported);
    return true;
  }, []);

  const reset = useCallback(() => {
    setCustomization(getDefaultCustomization());
  }, []);

  const isModified = customization.activePreset === "custom";

  return (
    <CustomThemeContext.Provider value={{
      customization,
      applyPreset,
      setColors,
      setChartPalette,
      setCardStyle,
      setDensity,
      setTypeScale,
      setCustomVars,
      chartColors,
      exportCurrentTheme,
      importThemeFile,
      reset,
      isModified,
    }}>
      {children}
    </CustomThemeContext.Provider>
  );
}

export function useCustomTheme() {
  const ctx = useContext(CustomThemeContext);
  if (!ctx) throw new Error("useCustomTheme must be used within CustomThemeProvider");
  return ctx;
}

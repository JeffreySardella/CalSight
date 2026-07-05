/**
 * Theme persistence — localStorage read/write and JSON export/import.
 */

import type { ThemeCustomization, ExportedTheme } from "./types";
import { getDefaultCustomization } from "./presets";
import { safeGetItem, safeSetItem, safeRemoveItem } from "../safeStorage";

const STORAGE_KEY = "calsight-theme-customization";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString<T extends string>(v: unknown, fallback: T): T {
  return typeof v === "string" ? (v as T) : fallback;
}

/**
 * Rebuild a guaranteed-valid customization from an untrusted parsed value,
 * taking each field only when it has the right *type* and otherwise falling
 * back to the default. The old code only checked truthiness (`!parsed.colors`),
 * so a legacy/corrupt theme with e.g. `colors` as a string slipped through and
 * crashed the app on apply — and because the crash handler's "Reload" never
 * cleared the theme key, the app reload-looped (M-F2). This makes any parseable
 * value safe, and partial/legacy themes hydrate from the default.
 */
function hydrateCustomization(raw: unknown): ThemeCustomization {
  const def = getDefaultCustomization();
  if (!isObject(raw)) return def;
  const colors = isObject(raw.colors) ? raw.colors : {};
  const chart = isObject(raw.chart) ? raw.chart : {};
  return {
    activePreset: asString(raw.activePreset, def.activePreset),
    colors: {
      primary: asString(colors.primary, def.colors.primary),
      tertiary: asString(colors.tertiary, def.colors.tertiary),
      error: asString(colors.error, def.colors.error),
    },
    chart: {
      palette: asString(chart.palette, def.chart.palette),
      customColors: Array.isArray(chart.customColors)
        ? chart.customColors.filter((c): c is string => typeof c === "string")
        : def.chart.customColors,
    },
    cardStyle: asString(raw.cardStyle, def.cardStyle),
    density: asString(raw.density, def.density),
    typeScale: asString(raw.typeScale, def.typeScale),
    customVars: isObject(raw.customVars)
      ? (Object.fromEntries(
          Object.entries(raw.customVars).filter(([, v]) => typeof v === "string"),
        ) as Record<string, string>)
      : def.customVars,
  };
}

/**
 * Load persisted customization from localStorage.
 * Returns a fully-valid customization even if the stored value is corrupt or
 * from an older schema. Unparseable JSON is cleared so it can't reload-loop.
 */
export function loadCustomization(): ThemeCustomization {
  const raw = safeGetItem(STORAGE_KEY);
  if (!raw) return getDefaultCustomization();
  try {
    return hydrateCustomization(JSON.parse(raw));
  } catch {
    safeRemoveItem(STORAGE_KEY);
    return getDefaultCustomization();
  }
}

/**
 * Persist customization to localStorage.
 */
export function saveCustomization(customization: ThemeCustomization): void {
  safeSetItem(STORAGE_KEY, JSON.stringify(customization));
}

/**
 * Export the current customization as a downloadable JSON file.
 */
export function exportTheme(customization: ThemeCustomization, name?: string): void {
  const exported: ExportedTheme = {
    name: name ?? `CalSight Theme ${new Date().toLocaleDateString()}`,
    version: 1,
    createdAt: new Date().toISOString(),
    customization,
  };

  const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `calsight-theme-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Import a theme from a JSON file. Returns the customization or null if invalid.
 */
export function importTheme(file: File): Promise<ThemeCustomization | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = JSON.parse(text) as ExportedTheme;
        if (parsed.version !== 1 || !parsed.customization?.colors) {
          resolve(null);
          return;
        }
        resolve(parsed.customization);
      } catch {
        resolve(null);
      }
    };
    reader.onerror = () => resolve(null);
    reader.readAsText(file);
  });
}

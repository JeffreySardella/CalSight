/**
 * Theme persistence — localStorage read/write and JSON export/import.
 */

import type { ThemeCustomization, ExportedTheme } from "./types";
import { getDefaultCustomization } from "./presets";

const STORAGE_KEY = "calsight-theme-customization";

/**
 * Load persisted customization from localStorage.
 * Returns the default if nothing is stored or if the stored value is invalid.
 */
export function loadCustomization(): ThemeCustomization {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultCustomization();
    const parsed = JSON.parse(raw) as ThemeCustomization;
    // Basic shape validation
    if (!parsed.colors || !parsed.chart || !parsed.cardStyle) {
      return getDefaultCustomization();
    }
    return parsed;
  } catch {
    return getDefaultCustomization();
  }
}

/**
 * Persist customization to localStorage.
 */
export function saveCustomization(customization: ThemeCustomization): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(customization));
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

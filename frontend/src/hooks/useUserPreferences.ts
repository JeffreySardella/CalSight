import { useSyncExternalStore } from "react";
import { safeGetItem, safeRemoveItem, safeSetItem } from "../lib/safeStorage";

const STORAGE_KEY = "calsight-preferences";
const CURRENT_VERSION = 1;

export type Theme = "light" | "dark" | "system";
export type MotionPref = "system" | "on" | "off";
export type LiteModeSetting = "on" | "off" | "auto";
export type FilterMode = "simple" | "advanced";

export interface UserPreferences {
  version: 1;
  /** County name (e.g. "Los Angeles"), or null = no default. */
  defaultCounty: string | null;
  theme: Theme;
  highContrast: boolean;
  reducedMotion: MotionPref;
  liteMode: LiteModeSetting;
  filterMode: FilterMode;
}

const DEFAULTS: UserPreferences = {
  version: 1,
  defaultCounty: null,
  theme: "system",
  highContrast: false,
  reducedMotion: "system",
  liteMode: "off",
  filterMode: "simple",
};

const LEGACY_KEYS = [
  "calsight-theme",
  "calsight-high-contrast",
  "calsight-reduced-motion",
  "calsight-lite-mode",
  "calsight-filter-mode",
] as const;

function isTheme(v: unknown): v is Theme {
  return v === "light" || v === "dark" || v === "system";
}
function isMotion(v: unknown): v is MotionPref {
  return v === "system" || v === "on" || v === "off";
}
function isLite(v: unknown): v is LiteModeSetting {
  return v === "on" || v === "off" || v === "auto";
}
function isFilterMode(v: unknown): v is FilterMode {
  return v === "simple" || v === "advanced";
}

function migrateFromLegacy(): UserPreferences {
  const theme = safeGetItem("calsight-theme");
  const highContrast = safeGetItem("calsight-high-contrast");
  const reducedMotion = safeGetItem("calsight-reduced-motion");
  const liteMode = safeGetItem("calsight-lite-mode");
  const filterMode = safeGetItem("calsight-filter-mode");

  const anyLegacy =
    theme !== null ||
    highContrast !== null ||
    reducedMotion !== null ||
    liteMode !== null ||
    filterMode !== null;

  if (!anyLegacy) return DEFAULTS;

  const merged: UserPreferences = {
    ...DEFAULTS,
    theme: isTheme(theme) ? theme : DEFAULTS.theme,
    highContrast: highContrast === "true",
    reducedMotion: isMotion(reducedMotion) ? reducedMotion : DEFAULTS.reducedMotion,
    liteMode: isLite(liteMode) ? liteMode : DEFAULTS.liteMode,
    filterMode: isFilterMode(filterMode) ? filterMode : DEFAULTS.filterMode,
  };

  safeSetItem(STORAGE_KEY, JSON.stringify(merged));
  for (const k of LEGACY_KEYS) safeRemoveItem(k);
  return merged;
}

function migrate(parsed: unknown): UserPreferences {
  if (typeof parsed !== "object" || parsed === null) return DEFAULTS;
  const obj = parsed as Record<string, unknown>;
  // Only v1 exists today. When the schema changes, branch on obj.version here
  // and rewrite older shapes into the latest. Keys are validated individually
  // so a corrupt field falls back to the default instead of poisoning everything.
  return {
    version: CURRENT_VERSION,
    defaultCounty: typeof obj.defaultCounty === "string" ? obj.defaultCounty : DEFAULTS.defaultCounty,
    theme: isTheme(obj.theme) ? obj.theme : DEFAULTS.theme,
    highContrast: typeof obj.highContrast === "boolean" ? obj.highContrast : DEFAULTS.highContrast,
    reducedMotion: isMotion(obj.reducedMotion) ? obj.reducedMotion : DEFAULTS.reducedMotion,
    liteMode: isLite(obj.liteMode) ? obj.liteMode : DEFAULTS.liteMode,
    filterMode: isFilterMode(obj.filterMode) ? obj.filterMode : DEFAULTS.filterMode,
  };
}

function loadInitial(): UserPreferences {
  const raw = safeGetItem(STORAGE_KEY);
  if (raw) {
    try {
      return migrate(JSON.parse(raw));
    } catch {
      // Corrupt JSON — fall through to legacy migration.
    }
  }
  return migrateFromLegacy();
}

let current: UserPreferences = loadInitial();
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): UserPreferences {
  return current;
}

export function getPreferences(): UserPreferences {
  return current;
}

export function setPreferences(
  updates: Partial<Omit<UserPreferences, "version">>,
): void {
  current = { ...current, ...updates, version: CURRENT_VERSION };
  safeSetItem(STORAGE_KEY, JSON.stringify(current));
  listeners.forEach((l) => l());
}

/** Test-only reset. Clears in-memory state and persisted JSON. */
export function __resetPreferencesForTests(): void {
  current = { ...DEFAULTS };
  safeRemoveItem(STORAGE_KEY);
  for (const k of LEGACY_KEYS) safeRemoveItem(k);
  listeners.forEach((l) => l());
}

export function useUserPreferences(): UserPreferences {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

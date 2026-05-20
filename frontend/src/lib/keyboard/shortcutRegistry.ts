/**
 * Shortcut Registry — central definition of all keyboard shortcuts.
 *
 * Each shortcut has:
 *  - id: unique key for remapping and storage
 *  - keys: default key combo (modifier+key format)
 *  - label: human-readable description
 *  - category: grouping for the cheat sheet
 *  - context: when the shortcut is active ("global", "grid", "chart")
 */

export type ShortcutContext = "global" | "grid" | "chart";

export type ShortcutCategory =
  | "navigation"
  | "presets"
  | "builder"
  | "chart"
  | "palette"
  | "general";

export interface ShortcutDef {
  id: string;
  keys: string; // e.g. "ctrl+k", "j", "shift+?"
  label: string;
  category: ShortcutCategory;
  context: ShortcutContext;
}

/**
 * Parse a key combo string into its constituents.
 * Format: "mod+mod+key" where mod is ctrl/meta/shift/alt
 * "meta" means Cmd on Mac, Ctrl on Windows/Linux.
 */
export interface ParsedCombo {
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  key: string; // normalized lowercase
}

export function parseCombo(combo: string): ParsedCombo {
  const parts = combo.toLowerCase().split("+");
  const key = parts.pop() ?? "";
  return {
    ctrl: parts.includes("ctrl"),
    meta: parts.includes("meta"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
    key,
  };
}

/**
 * Check if a KeyboardEvent matches a parsed combo.
 * "meta" in our system matches either Cmd (metaKey) or Ctrl (ctrlKey)
 * so that Ctrl+K works on both Mac and Windows.
 */
export function matchesCombo(e: KeyboardEvent, combo: ParsedCombo): boolean {
  const eventKey = e.key.toLowerCase();

  // For "meta" modifier: accept either metaKey or ctrlKey
  if (combo.meta) {
    const hasModifier = e.metaKey || e.ctrlKey;
    if (!hasModifier) return false;
  } else {
    // If not expecting meta, but ctrl is explicitly required
    if (combo.ctrl && !e.ctrlKey) return false;
  }

  if (combo.shift && !e.shiftKey) return false;
  if (combo.alt && !e.altKey) return false;

  // Match the actual key
  if (combo.key === "?" && eventKey === "?" && e.shiftKey) return true;
  if (combo.key === "escape" && eventKey === "escape") return true;

  return eventKey === combo.key;
}

/**
 * Format a combo for display.
 */
export function formatCombo(combo: string): string {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
  return combo
    .split("+")
    .map((part) => {
      switch (part.toLowerCase()) {
        case "meta": return isMac ? "⌘" : "Ctrl";
        case "ctrl": return isMac ? "⌃" : "Ctrl";
        case "shift": return "⇧";
        case "alt": return isMac ? "⌥" : "Alt";
        case "escape": return "Esc";
        case "enter": return "↵";
        case "arrowup": return "↑";
        case "arrowdown": return "↓";
        case "arrowleft": return "←";
        case "arrowright": return "→";
        default: return part.toUpperCase();
      }
    })
    .join(isMac ? "" : "+");
}

// ---------------------------------------------------------------------------
// Default shortcut definitions
// ---------------------------------------------------------------------------

export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  // Global — Command Palette
  { id: "palette.open", keys: "meta+k", label: "Open command palette", category: "palette", context: "global" },
  { id: "palette.close", keys: "escape", label: "Close command palette", category: "palette", context: "global" },

  // Global — General
  { id: "general.help", keys: "shift+?", label: "Show keyboard shortcuts", category: "general", context: "global" },
  { id: "general.escape", keys: "escape", label: "Close overlay / deselect", category: "general", context: "global" },
  { id: "general.focus-nlq", keys: "/", label: "Focus NLQ search bar", category: "general", context: "global" },
  { id: "general.filters", keys: "f", label: "Open filters panel", category: "general", context: "global" },

  // Presets
  { id: "preset.1", keys: "1", label: "Preset: Safety Overview", category: "presets", context: "global" },
  { id: "preset.2", keys: "2", label: "Preset: Time Patterns", category: "presets", context: "global" },
  { id: "preset.3", keys: "3", label: "Preset: Demographics", category: "presets", context: "global" },
  { id: "preset.4", keys: "4", label: "Preset: Fatality Focus", category: "presets", context: "global" },
  { id: "preset.5", keys: "5", label: "Preset: DUI Deep Dive", category: "presets", context: "global" },
  { id: "preset.6", keys: "6", label: "Preset: Injury Analysis", category: "presets", context: "global" },
  { id: "preset.7", keys: "7", label: "Preset: Equity & Safety", category: "presets", context: "global" },
  { id: "preset.8", keys: "8", label: "Preset: County Comparison", category: "presets", context: "global" },

  // Builder
  { id: "builder.toggle", keys: "b", label: "Switch to builder mode", category: "builder", context: "global" },
  { id: "builder.add-chart", keys: "meta+n", label: "Quick-add new chart", category: "builder", context: "global" },
  { id: "builder.share", keys: "meta+shift+s", label: "Share dashboard URL", category: "builder", context: "global" },

  // Grid navigation (vi-style)
  { id: "nav.left", keys: "h", label: "Move focus left", category: "navigation", context: "grid" },
  { id: "nav.down", keys: "j", label: "Move focus down", category: "navigation", context: "grid" },
  { id: "nav.up", keys: "k", label: "Move focus up", category: "navigation", context: "grid" },
  { id: "nav.right", keys: "l", label: "Move focus right", category: "navigation", context: "grid" },
  { id: "nav.first", keys: "g", label: "Jump to first chart", category: "navigation", context: "grid" },
  { id: "nav.last", keys: "shift+g", label: "Jump to last chart", category: "navigation", context: "grid" },

  // Chart-focused shortcuts
  { id: "chart.toggle-table", keys: "d", label: "Toggle data table view", category: "chart", context: "chart" },
  { id: "chart.trend", keys: "t", label: "Toggle trend line", category: "chart", context: "chart" },
  { id: "chart.mean", keys: "m", label: "Toggle mean line", category: "chart", context: "chart" },
  { id: "chart.explain", keys: "e", label: "Explain chart with AI", category: "chart", context: "chart" },
  { id: "chart.export-png", keys: "p", label: "Export chart as PNG", category: "chart", context: "chart" },
  { id: "chart.export-csv", keys: "c", label: "Export chart as CSV", category: "chart", context: "chart" },
  { id: "chart.fullscreen", keys: "enter", label: "Expand / interact with chart", category: "chart", context: "chart" },
  { id: "chart.remove", keys: "x", label: "Remove chart (builder mode)", category: "chart", context: "chart" },
];

// ---------------------------------------------------------------------------
// Remapping persistence
// ---------------------------------------------------------------------------

const REMAP_STORAGE_KEY = "calsight-keyboard-remaps";

export type RemapStore = Record<string, string>; // shortcut.id -> new combo

import { safeGetItem, safeSetItem } from "../safeStorage";

export function loadRemaps(): RemapStore {
  const raw = safeGetItem(REMAP_STORAGE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveRemaps(remaps: RemapStore): void {
  safeSetItem(REMAP_STORAGE_KEY, JSON.stringify(remaps));
}

/**
 * Resolve the effective key combo for a shortcut, considering user remaps.
 */
export function resolveKeys(def: ShortcutDef, remaps: RemapStore): string {
  return remaps[def.id] ?? def.keys;
}

/**
 * Get all shortcuts grouped by category.
 */
export function groupByCategory(shortcuts: ShortcutDef[]): Record<ShortcutCategory, ShortcutDef[]> {
  const groups: Record<ShortcutCategory, ShortcutDef[]> = {
    palette: [],
    general: [],
    navigation: [],
    presets: [],
    builder: [],
    chart: [],
  };
  for (const s of shortcuts) {
    groups[s.category].push(s);
  }
  return groups;
}

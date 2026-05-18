/**
 * Command Actions — all actions available in the command palette.
 *
 * Each command has a label, optional icon, category, and an action function.
 * The palette performs fuzzy matching against labels and aliases.
 */

import type { PresetKey, Dimension, Measure, ChartType } from "../dashboard/types";
import { DIMENSION_LABELS, MEASURE_LABELS } from "../dashboard/types";
import { PRESETS } from "../dashboard/presets";

export interface CommandAction {
  id: string;
  label: string;
  aliases?: string[]; // extra terms for fuzzy matching
  icon?: string; // Material Symbols icon name
  category: string;
  action: () => void;
}

export interface CommandPaletteCallbacks {
  setPreset: (key: PresetKey) => void;
  setMode: (mode: "simple" | "advanced") => void;
  addChart: (config: { dimension: Dimension; measure: Measure; chartType: ChartType }) => void;
  openFilters: () => void;
  closeFilters: () => void;
  clearFilters: () => void;
  shareUrl: () => void;
  printDashboard: () => void;
  focusNlq: () => void;
  toggleHelp: () => void;
  navigate: (path: string) => void;
}

/**
 * Build the full list of available commands given the current callbacks.
 */
export function buildCommandList(cb: CommandPaletteCallbacks): CommandAction[] {
  const commands: CommandAction[] = [];

  // Presets
  for (const [key, preset] of Object.entries(PRESETS)) {
    commands.push({
      id: `preset:${key}`,
      label: `Switch to ${preset.label}`,
      aliases: [key, preset.description],
      icon: preset.icon,
      category: "Presets",
      action: () => cb.setPreset(key as PresetKey),
    });
  }

  // Mode switching
  commands.push({
    id: "mode:simple",
    label: "Switch to Simple mode",
    aliases: ["preset", "simple"],
    icon: "dashboard",
    category: "Mode",
    action: () => cb.setMode("simple"),
  });
  commands.push({
    id: "mode:advanced",
    label: "Switch to Builder mode",
    aliases: ["advanced", "custom", "build"],
    icon: "construction",
    category: "Mode",
    action: () => cb.setMode("advanced"),
  });

  // Quick-add chart commands for common dimension/measure combos
  const quickCharts: { dim: Dimension; measure: Measure; chartType: ChartType }[] = [
    { dim: "year", measure: "count", chartType: "area" },
    { dim: "county", measure: "count", chartType: "hbar" },
    { dim: "severity", measure: "count", chartType: "donut" },
    { dim: "cause", measure: "count", chartType: "hbar" },
    { dim: "hour", measure: "count", chartType: "bar" },
    { dim: "day_of_week", measure: "count", chartType: "radar" },
    { dim: "county", measure: "killed", chartType: "lollipop" },
    { dim: "year", measure: "killed", chartType: "area" },
    { dim: "age_bracket", measure: "count", chartType: "bar" },
    { dim: "weather", measure: "count", chartType: "hbar" },
  ];
  for (const qc of quickCharts) {
    commands.push({
      id: `add-chart:${qc.dim}:${qc.measure}:${qc.chartType}`,
      label: `Add chart: ${MEASURE_LABELS[qc.measure]} by ${DIMENSION_LABELS[qc.dim]}`,
      aliases: [qc.dim, qc.measure, qc.chartType],
      icon: "add_chart",
      category: "Add Chart",
      action: () => {
        cb.setMode("advanced");
        cb.addChart({ dimension: qc.dim, measure: qc.measure, chartType: qc.chartType });
      },
    });
  }

  // Filters
  commands.push({
    id: "filters:open",
    label: "Open filters panel",
    aliases: ["filter", "county", "severity", "date"],
    icon: "filter_list",
    category: "Filters",
    action: cb.openFilters,
  });
  commands.push({
    id: "filters:clear",
    label: "Clear all filters",
    aliases: ["reset", "remove"],
    icon: "filter_list_off",
    category: "Filters",
    action: cb.clearFilters,
  });

  // Actions
  commands.push({
    id: "action:share",
    label: "Share dashboard URL",
    aliases: ["link", "copy", "url"],
    icon: "link",
    category: "Actions",
    action: cb.shareUrl,
  });
  commands.push({
    id: "action:print",
    label: "Print dashboard",
    aliases: ["pdf", "export"],
    icon: "print",
    category: "Actions",
    action: cb.printDashboard,
  });
  commands.push({
    id: "action:nlq",
    label: "Describe a chart (natural language)",
    aliases: ["search", "query", "type", "nlq"],
    icon: "search",
    category: "Actions",
    action: cb.focusNlq,
  });
  commands.push({
    id: "action:shortcuts",
    label: "Show keyboard shortcuts",
    aliases: ["help", "keys", "hotkeys", "bindings"],
    icon: "keyboard",
    category: "Actions",
    action: cb.toggleHelp,
  });

  // Navigation
  commands.push({
    id: "nav:map",
    label: "Go to Map page",
    aliases: ["map", "choropleth", "geographic"],
    icon: "map",
    category: "Navigate",
    action: () => cb.navigate("/map"),
  });
  commands.push({
    id: "nav:ask",
    label: "Go to Ask AI page",
    aliases: ["ai", "question", "ask"],
    icon: "auto_awesome",
    category: "Navigate",
    action: () => cb.navigate("/ask"),
  });
  commands.push({
    id: "nav:stats",
    label: "Go to Dashboard page",
    aliases: ["stats", "dashboard", "charts"],
    icon: "insights",
    category: "Navigate",
    action: () => cb.navigate("/stats"),
  });

  return commands;
}

/**
 * Simple fuzzy score: returns a relevance score (0 = no match, higher = better).
 * Checks if all query tokens appear (as substrings) in the target text.
 */
export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 1; // empty query matches everything

  const tokens = q.split(/\s+/);
  const t = target.toLowerCase();

  let score = 0;
  for (const token of tokens) {
    const idx = t.indexOf(token);
    if (idx === -1) return 0; // all tokens must be present
    // Bonus for exact start match
    score += idx === 0 ? 2 : 1;
  }
  // Bonus for shorter targets (more precise match)
  score += Math.max(0, 50 - target.length) / 50;
  return score;
}

/**
 * Filter and rank commands by fuzzy query.
 */
export function filterCommands(commands: CommandAction[], query: string): CommandAction[] {
  if (!query.trim()) return commands.slice(0, 15); // show top 15 when empty

  const scored = commands
    .map((cmd) => {
      const searchable = [cmd.label, ...(cmd.aliases ?? [])].join(" ");
      return { cmd, score: fuzzyScore(query, searchable) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, 12).map((x) => x.cmd);
}

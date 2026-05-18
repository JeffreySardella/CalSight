import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { PresetKey, ChartSlot, Dimension, Measure, ChartType } from "../lib/dashboard/types";
import { PRESET_KEYS } from "../lib/dashboard/presets";
import { useCommandPalette } from "./useCommandPalette";
import { useGridNavigation } from "./useGridNavigation";
import { useChartShortcuts } from "./useChartShortcuts";
import { useShortcutRegistry } from "./useShortcutRegistry";
import type { CommandPaletteCallbacks } from "../lib/keyboard/commandActions";
import { exportChartPng } from "../lib/export/chartExport";

/**
 * Master orchestrator hook for the keyboard power user system.
 *
 * Wires together:
 *  - Command palette (Cmd+K)
 *  - Vi grid navigation (h/j/k/l)
 *  - Chart-focused shortcuts (d/t/m/e/p/c)
 *  - Shortcut cheat sheet (Shift+?)
 *  - Quick-add chart (Cmd+N)
 *  - Preset switching (1-8)
 *  - Screen reader announcements
 *
 * Returns everything needed for the StatsPage to render overlays.
 */

interface UseDashboardPowerKeysOptions {
  charts: ChartSlot[];
  mode: "simple" | "advanced";
  setMode: (mode: "simple" | "advanced") => void;
  setPreset: (key: PresetKey) => void;
  addChart: (config: { dimension: Dimension; measure: Measure; chartType: ChartType }) => void;
  removeChart: (id: string) => void;
  updateChart: (id: string, updates: Partial<{ dimension: Dimension; measure: Measure; chartType: ChartType; options: import("../lib/dashboard/types").ChartOptions }>) => void;
  onOpenFilters: () => void;
  onCloseFilters: () => void;
  onClearFilters: () => void;
  onShareUrl: () => void;
  onPrint: () => void;
}

export function useDashboardPowerKeys(opts: UseDashboardPowerKeysOptions) {
  const navigate = useNavigate();
  const registry = useShortcutRegistry();

  // UI state for overlays
  const [showCheatSheet, setShowCheatSheet] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [keyboardActive, setKeyboardActive] = useState(false);

  // Track whether user is using keyboard (for hint bar visibility)
  useEffect(() => {
    function onKeyDown() { setKeyboardActive(true); }
    function onMouseDown() { setKeyboardActive(false); }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, []);

  // Screen reader announce helper
  const announce = useCallback((msg: string) => {
    setAnnouncement(msg);
    // Clear after a delay so repeated same messages still trigger
    setTimeout(() => setAnnouncement(""), 100);
  }, []);

  // NLQ focus callback
  const focusNlq = useCallback(() => {
    const input = document.querySelector<HTMLInputElement>('[aria-label="Natural language chart query"]');
    if (input) {
      input.focus();
      input.select();
    }
  }, []);

  // Toggle help
  const toggleHelp = useCallback(() => {
    setShowCheatSheet((v) => !v);
  }, []);

  // Command palette callbacks
  const paletteCallbacks: CommandPaletteCallbacks = useMemo(
    () => ({
      setPreset: (key) => { opts.setPreset(key); announce(`Switched to preset ${key}`); },
      setMode: (mode) => { opts.setMode(mode); announce(`Switched to ${mode} mode`); },
      addChart: (config) => { opts.setMode("advanced"); opts.addChart(config); announce("Chart added"); },
      openFilters: opts.onOpenFilters,
      closeFilters: opts.onCloseFilters,
      clearFilters: () => { opts.onClearFilters(); announce("All filters cleared"); },
      shareUrl: opts.onShareUrl,
      printDashboard: opts.onPrint,
      focusNlq,
      toggleHelp,
      navigate: (path) => navigate(path),
    }),
    [opts, announce, focusNlq, toggleHelp, navigate],
  );

  // Any overlay open = disable grid nav
  const anyOverlayOpen = showCheatSheet || showQuickAdd;

  // Command palette
  const palette = useCommandPalette({
    callbacks: paletteCallbacks,
    enabled: !showCheatSheet && !showQuickAdd,
  });

  const gridNavDisabled = anyOverlayOpen || palette.isOpen;

  // Grid navigation
  const gridNav = useGridNavigation({
    itemCount: opts.charts.length,
    enabled: !gridNavDisabled,
    onFocusChange: (idx) => {
      if (idx !== null && idx < opts.charts.length) {
        const chart = opts.charts[idx];
        const title = `${chart.dimension} ${chart.measure}`;
        announce(`Focused chart ${idx + 1} of ${opts.charts.length}: ${title}`);
      }
    },
  });

  // Chart data table toggle state (per chart)
  const [tableToggles, setTableToggles] = useState<Record<string, boolean>>({});

  const toggleTable = useCallback((chartId: string) => {
    setTableToggles((prev) => ({ ...prev, [chartId]: !prev[chartId] }));
    announce("Toggled data table view");
  }, [announce]);

  // Chart shortcuts
  const chartCallbacksRef = useRef(opts);
  chartCallbacksRef.current = opts;

  const chartShortcutCallbacks = useMemo(
    () => ({
      onToggleTable: (id: string) => toggleTable(id),
      onToggleTrend: (id: string) => {
        const chart = chartCallbacksRef.current.charts.find((c) => c.id === id);
        if (chart) {
          const current = chart.options?.trendLine ?? false;
          chartCallbacksRef.current.updateChart(id, { options: { ...chart.options, trendLine: !current } });
          announce(current ? "Trend line hidden" : "Trend line shown");
        }
      },
      onToggleMean: (id: string) => {
        const chart = chartCallbacksRef.current.charts.find((c) => c.id === id);
        if (chart) {
          const current = chart.options?.meanLine ?? false;
          chartCallbacksRef.current.updateChart(id, { options: { ...chart.options, meanLine: !current } });
          announce(current ? "Mean line hidden" : "Mean line shown");
        }
      },
      onExplain: (id: string) => {
        const chart = chartCallbacksRef.current.charts.find((c) => c.id === id);
        if (chart) {
          const question = `Explain the ${chart.dimension} by ${chart.measure} chart`;
          navigate(`/ask?q=${encodeURIComponent(question)}`);
        }
      },
      onExportPng: (id: string) => {
        const card = document.querySelector(`[data-chart-id="${id}"]`);
        const svg = card?.querySelector("svg");
        if (svg) {
          exportChartPng(svg as SVGSVGElement, `chart-${id}`);
          announce("Chart exported as PNG");
        }
      },
      onExportCsv: (id: string) => {
        // CSV export requires data — trigger via the chart card's button
        const card = document.querySelector(`[data-chart-id="${id}"]`);
        const csvBtn = card?.querySelector('[aria-label*="CSV"]') as HTMLButtonElement | null;
        if (csvBtn) {
          csvBtn.click();
          announce("Chart exported as CSV");
        }
      },
      onRemove: (id: string) => {
        chartCallbacksRef.current.removeChart(id);
        announce("Chart removed");
      },
      isBuilderMode: opts.mode === "advanced",
    }),
    [toggleTable, announce, navigate, opts.mode],
  );

  useChartShortcuts({
    charts: opts.charts,
    focusedIndex: gridNav.focusedIndex,
    callbacks: chartShortcutCallbacks,
    enabled: !gridNavDisabled,
  });

  // Global shortcuts: presets (1-8), B, /, F, Shift+?, Cmd+N
  useEffect(() => {
    if (palette.isOpen || anyOverlayOpen) return;

    function isInputFocused(): boolean {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if ((el as HTMLElement).isContentEditable) return true;
      if (el.closest("[role='dialog']")) return true;
      return false;
    }

    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+N: quick add chart
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        setShowQuickAdd(true);
        return;
      }

      if (isInputFocused()) return;

      // Shift+?: show cheat sheet
      if (e.key === "?" && e.shiftKey) {
        e.preventDefault();
        setShowCheatSheet((v) => !v);
        return;
      }

      // / : focus NLQ bar
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        focusNlq();
        return;
      }

      // F: open filters
      if (e.key === "f" || e.key === "F") {
        // Only if not in a focused chart card
        if (!document.activeElement?.closest("[data-chart-id]")) {
          e.preventDefault();
          opts.onOpenFilters();
          return;
        }
      }

      // B: builder mode
      if ((e.key === "b" || e.key === "B") && !e.ctrlKey && !e.metaKey) {
        if (!document.activeElement?.closest("[data-chart-id]")) {
          e.preventDefault();
          opts.setMode("advanced");
          announce("Builder mode activated");
          return;
        }
      }

      // Number keys 1-8: presets
      if (e.key >= "1" && e.key <= "8" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!document.activeElement?.closest("[data-chart-id]")) {
          const idx = parseInt(e.key, 10) - 1;
          if (idx < PRESET_KEYS.length) {
            e.preventDefault();
            opts.setPreset(PRESET_KEYS[idx]);
            announce(`Switched to preset ${PRESET_KEYS[idx]}`);
          }
        }
        return;
      }

      // Escape: close config / clear focus
      if (e.key === "Escape") {
        gridNav.clearFocus();
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [palette.isOpen, anyOverlayOpen, opts, gridNav, focusNlq, announce]);

  return {
    // Command palette
    palette,

    // Grid navigation
    gridNav,

    // Overlays
    showCheatSheet,
    setShowCheatSheet,
    showQuickAdd,
    setShowQuickAdd,

    // Registry (for cheat sheet rendering)
    registry,

    // State
    tableToggles,
    keyboardActive,

    // Screen reader
    announcement,

    // Helpers
    toggleHelp,
  };
}

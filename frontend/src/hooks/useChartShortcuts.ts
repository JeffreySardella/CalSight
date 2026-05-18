import { useEffect, useCallback } from "react";
import type { ChartSlot } from "../lib/dashboard/types";

/**
 * Keyboard shortcuts that operate on the currently focused chart card.
 *
 * When a chart card has DOM focus (via vi-navigation or tab):
 *  - D: toggle data table
 *  - T: toggle trend line
 *  - M: toggle mean line
 *  - E: explain chart with AI
 *  - P: export as PNG
 *  - C: export as CSV
 *  - X: remove chart (in builder mode)
 *  - Enter: expand/fullscreen
 */

export interface ChartShortcutCallbacks {
  onToggleTable: (chartId: string) => void;
  onToggleTrend: (chartId: string) => void;
  onToggleMean: (chartId: string) => void;
  onExplain: (chartId: string) => void;
  onExportPng: (chartId: string) => void;
  onExportCsv: (chartId: string) => void;
  onRemove: (chartId: string) => void;
  isBuilderMode: boolean;
}

interface UseChartShortcutsOptions {
  charts: ChartSlot[];
  focusedIndex: number | null;
  callbacks: ChartShortcutCallbacks;
  enabled?: boolean;
}

function getActiveChartId(selector: string): string | null {
  const el = document.activeElement;
  if (!el) return null;
  const card = el.closest(selector) as HTMLElement | null;
  return card?.dataset.chartId ?? null;
}

export function useChartShortcuts({
  charts,
  focusedIndex,
  callbacks,
  enabled = true,
}: UseChartShortcutsOptions) {
  const getFocusedChartId = useCallback((): string | null => {
    // First try DOM active element
    const domId = getActiveChartId("[data-chart-id]");
    if (domId) return domId;
    // Fall back to index-based
    if (focusedIndex !== null && focusedIndex < charts.length) {
      return charts[focusedIndex].id;
    }
    return null;
  }, [charts, focusedIndex]);

  useEffect(() => {
    if (!enabled) return;

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
      if (isInputFocused()) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const chartId = getFocusedChartId();
      if (!chartId) return;

      // Only respond to chart-specific keys when a chart card actually has focus
      const el = document.activeElement;
      if (!el?.closest("[data-chart-id]")) return;

      switch (e.key) {
        case "d":
        case "D":
          e.preventDefault();
          callbacks.onToggleTable(chartId);
          break;
        case "t":
        case "T":
          e.preventDefault();
          callbacks.onToggleTrend(chartId);
          break;
        case "m":
        case "M":
          e.preventDefault();
          callbacks.onToggleMean(chartId);
          break;
        case "e":
        case "E":
          e.preventDefault();
          callbacks.onExplain(chartId);
          break;
        case "p":
        case "P":
          e.preventDefault();
          callbacks.onExportPng(chartId);
          break;
        case "c":
        case "C":
          e.preventDefault();
          callbacks.onExportCsv(chartId);
          break;
        case "x":
        case "X":
          if (callbacks.isBuilderMode) {
            e.preventDefault();
            callbacks.onRemove(chartId);
          }
          break;
        default:
          return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enabled, getFocusedChartId, callbacks]);
}

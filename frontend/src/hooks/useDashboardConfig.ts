import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { DashboardConfig, ChartSlot, Dimension, Measure, ChartType, ChartOptions, PresetKey } from "../lib/dashboard/types";
import { DIMENSIONS, MEASURES } from "../lib/dashboard/types";
import { generateId } from "../lib/dashboard/types";
import { buildPresetCharts, PRESET_KEYS, PRESETS } from "../lib/dashboard/presets";
import { decodeDashboard } from "../lib/dashboard/urlCodec";

const STORAGE_KEY = "calsight-dashboard-v1";
const URL_PARAM = "dashboard";

const VALID_MODES = new Set(["simple", "advanced"]);

function isValidConfig(p: unknown): p is DashboardConfig {
  if (!p || typeof p !== "object") return false;
  const c = p as Record<string, unknown>;
  if (!VALID_MODES.has(c.mode as string)) return false;
  if (!PRESET_KEYS.includes(c.preset as PresetKey)) return false;
  if (!Array.isArray(c.charts)) return false;
  return c.charts.every(
    (s: Record<string, unknown>) =>
      typeof s.id === "string" &&
      typeof s.order === "number" &&
      (DIMENSIONS as readonly string[]).includes(s.dimension as string) &&
      (MEASURES as readonly string[]).includes(s.measure as string) &&
      ["bar", "hbar", "line", "area", "donut", "treemap", "gauge", "stat", "polar", "lollipop", "radar", "scatter"].includes(s.chartType as string),
  );
}

function loadInitialConfig(): DashboardConfig {
  if (typeof window === "undefined") return { mode: "simple", preset: "overview", charts: [] };

  const params = new URLSearchParams(window.location.search);
  const urlVal = params.get(URL_PARAM);
  if (urlVal) {
    const decoded = decodeDashboard(urlVal);
    if (decoded && isValidConfig(decoded)) return decoded;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (isValidConfig(parsed)) return parsed;
    }
  } catch { /* corrupted localStorage */ }

  return { mode: "simple", preset: "overview", charts: [] };
}

type NewChart = { dimension: Dimension; measure: Measure; secondaryMeasure?: Measure; chartType: ChartType; splitBy?: Dimension; options?: ChartOptions };

export function useDashboardConfig() {
  const [config, setConfig] = useState<DashboardConfig>(loadInitialConfig);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    const id = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    }, 400);
    return () => clearTimeout(id);
  }, [config]);

  const setMode = useCallback((mode: "simple" | "advanced") => {
    setConfig((prev) => {
      if (prev.mode === mode) return prev;
      if (mode === "advanced") return { ...prev, mode, charts: [] };
      return { ...prev, mode };
    });
  }, []);

  const setPreset = useCallback((preset: PresetKey) => {
    setConfig((prev) => ({ ...prev, preset, mode: "simple" }));
  }, []);

  const MAX_CHARTS = 12;

  const addChart = useCallback((chart: NewChart) => {
    setConfig((prev) => {
      if (prev.charts.length >= MAX_CHARTS) return prev;
      const order = prev.charts.length;
      const slot: ChartSlot = { ...chart, id: generateId(), order };
      return { ...prev, charts: [...prev.charts, slot] };
    });
  }, []);

  const removeChart = useCallback((id: string) => {
    setConfig((prev) => ({
      ...prev,
      charts: prev.charts.filter((c) => c.id !== id).map((c, i) => ({ ...c, order: i })),
    }));
  }, []);

  const updateChart = useCallback((id: string, updates: Partial<NewChart>) => {
    setConfig((prev) => ({
      ...prev,
      charts: prev.charts.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }));
  }, []);

  const moveChart = useCallback((id: string, direction: "up" | "down") => {
    setConfig((prev) => {
      const idx = prev.charts.findIndex((c) => c.id === id);
      if (idx < 0) return prev;
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= prev.charts.length) return prev;
      const next = [...prev.charts];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return { ...prev, charts: next.map((c, i) => ({ ...c, order: i })) };
    });
  }, []);

  const reorderChart = useCallback((fromIndex: number, toIndex: number) => {
    setConfig((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.charts.length) return prev;
      if (toIndex < 0 || toIndex >= prev.charts.length) return prev;
      if (fromIndex === toIndex) return prev;
      const next = [...prev.charts];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return { ...prev, charts: next.map((c, i) => ({ ...c, order: i })) };
    });
  }, []);

  const activeCharts = useMemo<ChartSlot[]>(() => {
    if (config.mode === "simple") {
      return buildPresetCharts(config.preset);
    }
    return [...config.charts].sort((a, b) => a.order - b.order);
  }, [config.mode, config.preset, config.charts]);

  const presetFilterOverrides = useMemo(() => {
    if (config.mode !== "simple") return undefined;
    return PRESETS[config.preset]?.filterOverrides;
  }, [config.mode, config.preset]);

  const clearCharts = useCallback(() => {
    setConfig((prev) => ({ ...prev, charts: [] }));
  }, []);

  return {
    config,
    setConfig,
    activeCharts,
    presetFilterOverrides,
    setMode,
    setPreset,
    addChart,
    removeChart,
    updateChart,
    moveChart,
    reorderChart,
    clearCharts,
  };
}

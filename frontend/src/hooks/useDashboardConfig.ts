import { useState, useCallback, useMemo, useEffect } from "react";
import type { DashboardConfig, ChartSlot, Dimension, Measure, ChartType, PresetKey } from "../lib/dashboard/types";
import { generateId } from "../lib/dashboard/types";
import { buildPresetCharts } from "../lib/dashboard/presets";
import { encodeDashboard, decodeDashboard } from "../lib/dashboard/urlCodec";

const STORAGE_KEY = "calsight-dashboard-v1";
const URL_PARAM = "dashboard";

function loadInitialConfig(): DashboardConfig {
  const params = new URLSearchParams(window.location.search);
  const urlVal = params.get(URL_PARAM);
  if (urlVal) {
    const decoded = decodeDashboard(urlVal);
    if (decoded) return decoded;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as DashboardConfig;
      if (parsed && parsed.mode) return parsed;
    }
  } catch {}

  return { mode: "simple", preset: "overview", charts: [] };
}

type NewChart = { dimension: Dimension; measure: Measure; chartType: ChartType; splitBy?: Dimension };

export function useDashboardConfig() {
  const [config, setConfig] = useState<DashboardConfig>(loadInitialConfig);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  const setMode = useCallback((mode: "simple" | "advanced") => {
    setConfig((prev) => ({
      ...prev,
      mode,
      charts: mode === "advanced" ? prev.charts : prev.charts,
    }));
  }, []);

  const setPreset = useCallback((preset: PresetKey) => {
    setConfig((prev) => ({ ...prev, preset, mode: "simple" }));
  }, []);

  const addChart = useCallback((chart: NewChart) => {
    setConfig((prev) => {
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

  const activeCharts = useMemo<ChartSlot[]>(() => {
    if (config.mode === "simple") {
      return buildPresetCharts(config.preset);
    }
    return [...config.charts].sort((a, b) => a.order - b.order);
  }, [config.mode, config.preset, config.charts]);

  const shareUrl = useMemo(() => {
    const base = `${window.location.origin}/stats`;
    const params = new URLSearchParams(window.location.search);
    params.set(URL_PARAM, encodeDashboard(config));
    return `${base}?${params.toString()}`;
  }, [config]);

  return {
    config,
    activeCharts,
    shareUrl,
    setMode,
    setPreset,
    addChart,
    removeChart,
    updateChart,
    moveChart,
  };
}

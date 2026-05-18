import { useState, useCallback, useMemo } from "react";
import type { Dimension } from "../lib/dashboard/types";

export type CrossFilterSelection = {
  type: "category";
  dimension: Dimension;
  values: string[];
};

export type CrossFilterState = {
  sourceChartId: string | null;
  selection: CrossFilterSelection | null;
};

export type CrossFilterOverrides = {
  severity?: string;
  cause?: string;
  county?: string;
  start?: string;
  end?: string;
};

export type CrossFilterAPI = {
  state: CrossFilterState;
  toggleCategory: (chartId: string, dimension: Dimension, value: string) => void;
  clearCrossFilter: () => void;
  toFilterOverrides: () => CrossFilterOverrides;
};

const SEVERITY_SLUG: Record<string, string> = {
  "Fatal": "fatal",
  "Injury": "injury",
  "Property Damage Only": "property-damage-only",
};

const CAUSE_SLUG: Record<string, string> = {
  "DUI": "dui",
  "Speeding": "speeding",
  "Lane Change": "lane-change",
  "Right of Way": "right-of-way",
  "Improper Turn": "turning",
  "Tailgating": "following-too-close",
  "Signal Violation": "signal-violation",
  "Pedestrian": "pedestrian-violation",
  "Unsafe Backing": "unsafe-backing",
  "Other": "other",
  "Uncategorized": "uncategorized",
};

export function useCrossFilter(): CrossFilterAPI {
  const [state, setState] = useState<CrossFilterState>({
    sourceChartId: null,
    selection: null,
  });

  const toggleCategory = useCallback((chartId: string, dimension: Dimension, value: string) => {
    setState((prev) => {
      // Click same value again on same chart -> clear
      if (
        prev.sourceChartId === chartId &&
        prev.selection?.dimension === dimension &&
        prev.selection.values.length === 1 &&
        prev.selection.values[0] === value
      ) {
        return { sourceChartId: null, selection: null };
      }
      return {
        sourceChartId: chartId,
        selection: { type: "category", dimension, values: [value] },
      };
    });
  }, []);

  const clearCrossFilter = useCallback(() => {
    setState({ sourceChartId: null, selection: null });
  }, []);

  const toFilterOverrides = useCallback((): CrossFilterOverrides => {
    if (!state.selection) return {};
    const { dimension, values } = state.selection;
    const val = values[0];
    if (!val) return {};

    switch (dimension) {
      case "severity": {
        const slug = SEVERITY_SLUG[val] ?? val.toLowerCase().replace(/ /g, "-");
        return { severity: slug };
      }
      case "cause": {
        const slug = CAUSE_SLUG[val] ?? val.toLowerCase().replace(/ /g, "-");
        return { cause: slug };
      }
      case "county": {
        return { county: val.toLowerCase().replace(/ /g, "-") };
      }
      case "year": {
        const y = parseInt(val, 10);
        if (!isNaN(y)) return { start: `${y}-01`, end: `${y}-12` };
        return {};
      }
      default:
        return {};
    }
  }, [state.selection]);

  const api = useMemo<CrossFilterAPI>(() => ({
    state,
    toggleCategory,
    clearCrossFilter,
    toFilterOverrides,
  }), [state, toggleCategory, clearCrossFilter, toFilterOverrides]);

  return api;
}

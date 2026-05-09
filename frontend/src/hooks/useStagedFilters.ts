import { useState, useCallback } from "react";
import type { DateRangeFilter } from "./useFilterParams";

export interface StagedFilters {
  selectedYears: Set<number>;
  dateRange: DateRangeFilter | null;
  severities: Set<string>;
  causes: Set<string>;
  alcohol: boolean;
  distracted: boolean;
  pedestrian: boolean;
  cyclist: boolean;
  drug: boolean;
  driverAge: string | null;
}

const EMPTY: StagedFilters = {
  selectedYears: new Set(),
  dateRange: null,
  severities: new Set(),
  causes: new Set(),
  alcohol: false,
  distracted: false,
  pedestrian: false,
  cyclist: false,
  drug: false,
  driverAge: null,
};

export function useStagedFilters(initial: StagedFilters) {
  const [staged, setStaged] = useState<StagedFilters>(initial);

  const toggleYear = useCallback((year: number) => {
    setStaged((prev) => {
      const next = new Set(prev.selectedYears);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return { ...prev, selectedYears: next };
    });
  }, []);

  const setAllYears = useCallback(() => {
    setStaged((prev) => ({ ...prev, selectedYears: new Set() }));
  }, []);

  const toggleSeverity = useCallback((s: string) => {
    setStaged((prev) => {
      const next = new Set(prev.severities);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return { ...prev, severities: next };
    });
  }, []);

  const clearSeverities = useCallback(() => {
    setStaged((prev) => ({ ...prev, severities: new Set() }));
  }, []);

  const toggleCause = useCallback((c: string) => {
    setStaged((prev) => {
      const next = new Set(prev.causes);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return { ...prev, causes: next };
    });
  }, []);

  const clearCauses = useCallback(() => {
    setStaged((prev) => ({ ...prev, causes: new Set() }));
  }, []);

  const toggleInvolvement = useCallback((key: keyof Pick<StagedFilters, "alcohol" | "distracted" | "pedestrian" | "cyclist" | "drug">) => {
    setStaged((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const setDriverAge = useCallback((bracket: string | null) => {
    setStaged((prev) => ({ ...prev, driverAge: bracket }));
  }, []);

  const clearAll = useCallback(() => {
    setStaged(EMPTY);
  }, []);

  const reset = useCallback((to: StagedFilters) => {
    setStaged(to);
  }, []);

  const hasAnyFilter = staged.selectedYears.size > 0
    || staged.dateRange !== null
    || staged.severities.size > 0
    || staged.causes.size > 0
    || staged.alcohol || staged.distracted || staged.pedestrian
    || staged.cyclist || staged.drug || staged.driverAge !== null;

  const has2016Plus = staged.selectedYears.size === 0
    || [...staged.selectedYears].some((y) => y >= 2016);

  return {
    staged,
    toggleYear,
    setAllYears,
    toggleSeverity,
    clearSeverities,
    toggleCause,
    clearCauses,
    toggleInvolvement,
    setDriverAge,
    clearAll,
    reset,
    hasAnyFilter,
    has2016Plus,
  };
}

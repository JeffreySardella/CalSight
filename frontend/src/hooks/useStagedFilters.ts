import { useState, useCallback, useEffect, useRef } from "react";
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
  weather: Set<string>;
  lighting: Set<string>;
  collisionType: Set<string>;
  roadType: string | null;
  hitRun: boolean;
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
  weather: new Set(),
  lighting: new Set(),
  collisionType: new Set(),
  roadType: null,
  hitRun: false,
};

export function useStagedFilters(initial: StagedFilters) {
  const [staged, setStaged] = useState<StagedFilters>(initial);
  const prevInitialRef = useRef(initial);

  useEffect(() => {
    if (prevInitialRef.current !== initial) {
      setStaged(initial);
      prevInitialRef.current = initial;
    }
  }, [initial]);

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

  const setDateRange = useCallback((start: { year: number; month: number } | null, end: { year: number; month: number } | null) => {
    setStaged((prev) => ({
      ...prev,
      dateRange: start || end ? { start, end } : null,
    }));
  }, []);

  const setDriverAge = useCallback((bracket: string | null) => {
    setStaged((prev) => ({ ...prev, driverAge: bracket }));
  }, []);

  const toggleWeather = useCallback((v: string) => {
    setStaged((prev) => {
      const next = new Set(prev.weather);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return { ...prev, weather: next };
    });
  }, []);

  const clearWeather = useCallback(() => {
    setStaged((prev) => ({ ...prev, weather: new Set() }));
  }, []);

  const toggleLighting = useCallback((v: string) => {
    setStaged((prev) => {
      const next = new Set(prev.lighting);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return { ...prev, lighting: next };
    });
  }, []);

  const clearLighting = useCallback(() => {
    setStaged((prev) => ({ ...prev, lighting: new Set() }));
  }, []);

  const toggleCollisionType = useCallback((v: string) => {
    setStaged((prev) => {
      const next = new Set(prev.collisionType);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return { ...prev, collisionType: next };
    });
  }, []);

  const clearCollisionType = useCallback(() => {
    setStaged((prev) => ({ ...prev, collisionType: new Set() }));
  }, []);

  const setRoadType = useCallback((v: string | null) => {
    setStaged((prev) => ({ ...prev, roadType: v }));
  }, []);

  const toggleHitRun = useCallback(() => {
    setStaged((prev) => ({ ...prev, hitRun: !prev.hitRun }));
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
    || staged.cyclist || staged.drug || staged.driverAge !== null
    || staged.weather.size > 0 || staged.lighting.size > 0
    || staged.collisionType.size > 0 || staged.roadType !== null
    || staged.hitRun;

  const has2016Plus = (() => {
    if (staged.dateRange) {
      const endYear = staged.dateRange.end?.year ?? new Date().getFullYear();
      return endYear >= 2016;
    }
    if (staged.selectedYears.size === 0) return true;
    return [...staged.selectedYears].some((y) => y >= 2016);
  })();

  return {
    staged,
    toggleYear,
    setAllYears,
    toggleSeverity,
    clearSeverities,
    toggleCause,
    clearCauses,
    toggleInvolvement,
    setDateRange,
    setDriverAge,
    toggleWeather,
    clearWeather,
    toggleLighting,
    clearLighting,
    toggleCollisionType,
    clearCollisionType,
    setRoadType,
    toggleHitRun,
    clearAll,
    reset,
    hasAnyFilter,
    has2016Plus,
  };
}

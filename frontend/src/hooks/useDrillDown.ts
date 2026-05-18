import { useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { deslugify } from "./useFilterParams";

export type DrillLevel = "state" | "county";

export interface DrillState {
  level: DrillLevel;
  county: string | null;
}

/**
 * Manages geographic drill-down state via URL search params.
 * When drill_county is set, the dashboard filters to that single county.
 */
export function useDrillDown() {
  const [searchParams, setSearchParams] = useSearchParams();

  const drillCountySlug = searchParams.get("drill_county");

  const drillState = useMemo<DrillState>(() => {
    if (drillCountySlug) {
      return { level: "county", county: deslugify(drillCountySlug) };
    }
    return { level: "state", county: null };
  }, [drillCountySlug]);

  const drillToCounty = useCallback(
    (slug: string) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        params.set("drill_county", slug);
        return params;
      }, { replace: true, preventScrollReset: true });
    },
    [setSearchParams],
  );

  const drillUp = useCallback(() => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete("drill_county");
      return params;
    }, { replace: true, preventScrollReset: true });
  }, [setSearchParams]);

  const resetDrill = useCallback(() => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete("drill_county");
      return params;
    }, { replace: true, preventScrollReset: true });
  }, [setSearchParams]);

  return { drillState, drillToCounty, drillUp, resetDrill };
}

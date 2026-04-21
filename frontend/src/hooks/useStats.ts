// WHEN THE BACKEND IS READY:
//   Delete fixture stuff
//   Delete src/pages/StatsPage.fixtures.ts.

// delete fixture imports
import {
  fixtureHourly,
  fixtureYearly,
  fixtureCauses,
  fixtureHeroMetrics,
} from "../pages/StatsPage.fixtures";

import type {
  HourlyDataPoint,
  YearlyDataPoint,
  CauseDataPoint,
  HeroMetrics,
} from "../pages/StatsPage";

export interface StatsData {
  hourlyData:  HourlyDataPoint[];
  yearlyData:  YearlyDataPoint[];
  causesData:  CauseDataPoint[];
  heroMetrics: HeroMetrics;
}

export interface UseStatsResult {
  data:    StatsData | null;
  loading: boolean;
  error:   string | null;
}

export function useStats(): UseStatsResult {
  // TODO: Delete this when backend is ready
  return {
    data: {
      hourlyData:  fixtureHourly,
      yearlyData:  fixtureYearly,
      causesData:  fixtureCauses,
      heroMetrics: fixtureHeroMetrics,
    },
    loading: false,
    error:   null,
  };
  // delete up to here ^

  // TODO: implement real API call when backend is ready
}

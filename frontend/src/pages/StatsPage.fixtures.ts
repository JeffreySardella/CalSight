// Delete this file once the backend is wired up.
// These are placeholder values so the UI renders during development.

import type { HourlyDataPoint, YearlyDataPoint, CauseDataPoint, HeroMetrics } from "./StatsPage";

export const fixtureHourly: HourlyDataPoint[] = [
  1000, 750, 600, 500, 700, 900, 2250, 3250, 4000, 3500, 3000, 2750,
  3100, 3400, 3750, 4250, 5000, 4600, 4400, 3750, 3000, 2500, 2000, 1500,
].map((count, hour) => ({ hour, count }));

export const fixtureYearly: YearlyDataPoint[] = [
  { year: 2014, count: 40 },
  { year: 2015, count: 45 },
  { year: 2016, count: 55 },
  { year: 2017, count: 75 },
  { year: 2018, count: 100 },
  { year: 2019, count: 85 },
  { year: 2020, count: 50 },
  { year: 2021, count: 65 },
  { year: 2022, count: 70 },
  { year: 2023, count: 78 },
];

export const fixtureCauses: CauseDataPoint[] = [
  { label: "Speeding",    count: 5292 },
  { label: "DUI",         count: 2259 },
  { label: "Distraction", count: 1522 },
];

export const fixtureHeroMetrics: HeroMetrics = {
  totalIncidents:       12482,
  incidentYoYPct:       4.2,
  ksiRatePer100k:       8.3,
  yoyFatalityChangePct: -3.1,
};

export interface CalEnviroScreenData {
  county_code: number;
  ces_score: number | null;
  ces_percentile: number | null;
  pollution_burden: number | null;
  pop_characteristics: number | null;
  pm25_score: number | null;
  ozone_score: number | null;
  diesel_pm_score: number | null;
  pesticide_score: number | null;
  traffic_score: number | null;
  poverty_pct: number | null;
  unemployment_pct: number | null;
  education_pct: number | null;
  linguistic_isolation_pct: number | null;
  housing_burden_pct: number | null;
  tract_count: number | null;
}

export interface UnemploymentData {
  county_code: number;
  year: number;
  month: number;
  unemployment_rate: number | null;
}

import { describe, it, expect } from "vitest";
import { buildCountUrl } from "./useLiveCrashCount";
import { countyParam } from "./useFacetCounts";
import type { StagedFilters } from "./useStagedFilters";

const STAGED: StagedFilters = {
  selectedYears: new Set([2025]),
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

describe("buildCountUrl", () => {
  it("counts the picked county, not the whole state", () => {
    const url = new URL(buildCountUrl(STAGED, countyParam(new Set(["Fresno"]))), "http://x");
    expect(url.searchParams.get("county")).toBe("fresno");
    expect(url.searchParams.get("start")).toBe("2025-01");
  });

  it("leaves the county off when none is picked", () => {
    expect(buildCountUrl(STAGED, countyParam(new Set()))).not.toContain("county=");
  });
});

import { describe, it, expect } from "vitest";
import { measureLabel } from "./types";

describe("measureLabel", () => {
  it("calls a count of victims or at-fault parties people, not crashes", () => {
    for (const dim of ["mode", "gender", "age_bracket", "at_fault_gender", "at_fault_age_bracket"] as const) {
      expect(measureLabel(dim, "count")).toBe("People");
    }
  });

  it("keeps the crash wording on crash-level dimensions", () => {
    expect(measureLabel("county", "count")).toBe("Crash Count");
    expect(measureLabel("year", "count")).toBe("Crash Count");
  });

  it("leaves every other measure alone on person-level dimensions", () => {
    expect(measureLabel("mode", "killed")).toBe("Fatalities");
    expect(measureLabel("gender", "injured")).toBe("Injuries");
  });
});

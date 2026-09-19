import { sanitizeMeasure } from "./types";

describe("sanitizeMeasure", () => {
  it("keeps ksi on the year axis", () => {
    expect(sanitizeMeasure("year", "ksi")).toBe("ksi");
  });

  it("drops ksi anywhere else", () => {
    expect(sanitizeMeasure("county", "ksi")).toBeUndefined();
    expect(sanitizeMeasure("gender", "ksi")).toBeUndefined();
  });

  it("drops crash-only measures on person-level dimensions and nothing else", () => {
    expect(sanitizeMeasure("gender", "fatality_rate")).toBeUndefined();
    expect(sanitizeMeasure("age_bracket", "yoy_change")).toBeUndefined();
    expect(sanitizeMeasure("year", "fatality_rate")).toBe("fatality_rate");
    expect(sanitizeMeasure("gender", "injured")).toBe("injured");
    expect(sanitizeMeasure("year", undefined)).toBeUndefined();
  });
});

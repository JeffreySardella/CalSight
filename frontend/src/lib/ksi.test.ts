import { describe, it, expect } from "vitest";
import { KSI_DEFINITION, ksiDefinitionNote } from "./ksi";

describe("ksiDefinitionNote", () => {
  it("annotates ranges that cross 2015→2016", () => {
    expect(ksiDefinitionNote(["2014", "2015", "2016"])).toBe(`* ${KSI_DEFINITION}`);
    expect(ksiDefinitionNote([2010, 2020])).toBe(`* ${KSI_DEFINITION}`);
  });

  it("annotates ranges that cross 2017→2018 only", () => {
    expect(ksiDefinitionNote(["2017", "2018", "2019"])).toBe(`* ${KSI_DEFINITION}`);
  });

  it("stays quiet when no boundary is crossed", () => {
    expect(ksiDefinitionNote(["2019", "2020", "2025"])).toBeNull();
    expect(ksiDefinitionNote(["2001", "2014"])).toBeNull();
    expect(ksiDefinitionNote(["2016", "2017"])).toBeNull();
  });

  it("ignores empty and non-year labels", () => {
    expect(ksiDefinitionNote([])).toBeNull();
    expect(ksiDefinitionNote(["Fresno", "Kern"])).toBeNull();
  });

  it("names both boundaries in the shared text", () => {
    expect(KSI_DEFINITION).toContain("2015→2016");
    expect(KSI_DEFINITION).toContain("2017→2018");
  });
});

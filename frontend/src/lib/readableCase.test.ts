import { describe, it, expect } from "vitest";
import { toReadableCase } from "./readableCase";

describe("toReadableCase", () => {
  it("title-cases a road name and keeps the abbreviation capitalized", () => {
    expect(toReadableCase("BLACKSTONE AVE")).toBe("Blackstone Ave");
  });

  it("sentence-cases a single word", () => {
    expect(toReadableCase("CLEAR")).toBe("Clear");
  });

  it("spaces out a bare hyphen between clauses", () => {
    expect(toReadableCase("DARK-STREET LIGHTS")).toBe("Dark - street lights");
  });

  it("keeps route numbers uppercase", () => {
    expect(toReadableCase("SR-99")).toBe("SR-99");
    expect(toReadableCase("I-5")).toBe("I-5");
  });

  it("handles null/undefined/empty input", () => {
    expect(toReadableCase(null)).toBe("");
    expect(toReadableCase(undefined)).toBe("");
    expect(toReadableCase("")).toBe("");
    expect(toReadableCase("   ")).toBe("");
  });
});

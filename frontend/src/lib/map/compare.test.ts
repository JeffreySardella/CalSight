import { describe, it, expect } from "vitest";
import { isSelfCompare } from "./compare";

describe("isSelfCompare", () => {
  it("rejects picking the focused county as its own comparison", () => {
    expect(isSelfCompare(true, "Fresno", "Fresno")).toBe(true);
  });

  it("allows a different county while comparing", () => {
    expect(isSelfCompare(true, "Alameda", "Fresno")).toBe(false);
  });

  it("never blocks outside compare mode", () => {
    expect(isSelfCompare(false, "Fresno", "Fresno")).toBe(false);
  });

  it("never blocks when nothing is focused yet", () => {
    expect(isSelfCompare(true, "Fresno", null)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { CORRELATION_FIELDS } from "./useCorrelationData";

describe("FARS correlation fields", () => {
  it("registers fars_fatalities and pct_unrestrained", () => {
    const keys = CORRELATION_FIELDS.map((f) => f.key);
    expect(keys).toContain("fars_fatalities");
    expect(keys).toContain("pct_unrestrained");
    const fars = CORRELATION_FIELDS.find((f) => f.key === "fars_fatalities");
    expect(fars?.source).toBe("fars");
  });
});

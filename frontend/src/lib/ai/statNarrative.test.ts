import { describe, it, expect } from "vitest";
import { statNarrative, type DistributionPoint } from "./statNarrative";

const dist: DistributionPoint[] = [
  { id: "a", name: "A", value: 1 },
  { id: "b", name: "B", value: 2 },
  { id: "c", name: "C", value: 3 },
  { id: "d", name: "D", value: 4 },
];

describe("statNarrative", () => {
  it("ranks the worst (highest) subject rank 1", () => {
    const n = statNarrative({ label: "Fatality rate", value: 4, subjectId: "d", distribution: dist });
    expect(n.rank).toBe(1);
    expect(n.total).toBe(4);
  });

  it("computes percentile safer-than for a low value", () => {
    const n = statNarrative({ label: "Fatality rate", value: 1, subjectId: "a", distribution: dist });
    // safer than B, C, D = 3 of 4 = 75%
    expect(n.percentile).toBe(75);
    expect(n.paragraph).toContain("safer than 75%");
  });

  it("produces a non-empty paragraph naming the metric", () => {
    const n = statNarrative({ label: "Fatality rate", value: 2, subjectId: "b", distribution: dist });
    expect(n.paragraph.toLowerCase()).toContain("fatality rate");
  });
});

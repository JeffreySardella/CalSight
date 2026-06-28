import { describe, it, expect } from "vitest";
import { buildDeepDivePrompt } from "./AiCompanion";
import type { DataContext } from "../../lib/ai/dataContext";

const filters = {
  years: [2023], severities: ["Fatal"], counties: ["kern"], causes: [],
  alcohol: true, distracted: null, pedestrian: null, cyclist: null, drug: null,
  driverAge: null, weather: [], lighting: [], collisionType: [], roadType: null, hitRun: null,
};

describe("buildDeepDivePrompt", () => {
  it("includes the label, value, and active filters", () => {
    const ctx: DataContext = { kind: "stat", label: "Fatality rate · Kern", measure: "fatality_rate", value: 1.5, geography: { type: "county", id: "15", name: "Kern" }, filters };
    const prompt = buildDeepDivePrompt(ctx);
    expect(prompt).toContain("Fatality rate · Kern");
    expect(prompt).toContain("1.5");
    expect(prompt).toContain("Kern");
    expect(prompt.toLowerCase()).toContain("2023");
  });
});

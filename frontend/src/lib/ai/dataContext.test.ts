import { describe, it, expect } from "vitest";
import { hashContext, serializeContext, deserializeContext, type DataContext } from "./dataContext";

const emptyFilters = {
  years: [], severities: [], counties: [], causes: [],
  alcohol: null, distracted: null, pedestrian: null, cyclist: null, drug: null,
  driverAge: null, weather: [], lighting: [], collisionType: [], roadType: null, hitRun: null,
};

const ctx: DataContext = {
  kind: "stat", label: "Fatality rate · Kern County",
  measure: "fatality_rate", value: 1.23,
  geography: { type: "county", id: "15", name: "Kern" },
  filters: emptyFilters,
};

describe("dataContext", () => {
  it("round-trips through serialize/deserialize", () => {
    const restored = deserializeContext(serializeContext(ctx));
    expect(restored).toEqual(ctx);
  });

  it("returns null for malformed input", () => {
    expect(deserializeContext("not json")).toBeNull();
  });

  it("hashes equal contexts equally and differs on value", () => {
    expect(hashContext(ctx)).toBe(hashContext({ ...ctx }));
    expect(hashContext(ctx)).not.toBe(hashContext({ ...ctx, value: 9.99 }));
  });

  it("hashContext differs when only filters changes", () => {
    expect(hashContext(ctx)).not.toBe(
      hashContext({ ...ctx, filters: { ...emptyFilters, years: [2023] } }),
    );
  });

  it("deserializeContext returns null for unknown kind", () => {
    expect(deserializeContext('{"kind":"evil","filters":{}}')).toBeNull();
  });
});

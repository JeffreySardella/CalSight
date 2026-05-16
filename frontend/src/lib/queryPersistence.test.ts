import { describe, it, expect } from "vitest";
import type { Query } from "@tanstack/react-query";
import { shouldDehydrateQuery } from "./queryPersistence";

function fakeQuery(
  queryKey: unknown[],
  status: "success" | "error" | "pending" = "success",
  data: unknown = {},
): Query {
  return { queryKey, state: { status, data } } as unknown as Query;
}

describe("shouldDehydrateQuery", () => {
  const whitelisted: unknown[][] = [
    ["insight", "alameda", 2023],
    ["stats", "batch", { d: "2020-01|2024-12", co: ["Alameda"] }],
    ["stats", "demographics", { d: "2020-01|2024-12", co: ["Alameda"] }],
    ["choropleth", "stats", { d: "2020-01|2024-12" }],
    ["choropleth", "demographics", "2020-01|2024-12"],
    ["choropleth", "yearStats", { d: "2020-01|2024-12" }],
    ["calenviroscreen"],
    ["unemployment", "2020-01|2024-12"],
    ["data-quality", "county", "alameda"],
    ["data-quality", "statewide"],
  ];

  it("persists successful county-aggregate queries", () => {
    for (const key of whitelisted) {
      expect(shouldDehydrateQuery(fakeQuery(key))).toBe(true);
    }
  });

  it("never persists the crash-heatmap payload", () => {
    expect(
      shouldDehydrateQuery(fakeQuery(["crashHeatmap", "alameda", "2020-01|2024-12"])),
    ).toBe(false);
  });

  it("never persists non-success queries", () => {
    expect(shouldDehydrateQuery(fakeQuery(["stats", "batch", {}], "error"))).toBe(false);
    expect(
      shouldDehydrateQuery(fakeQuery(["insight", "alameda", 2023], "pending")),
    ).toBe(false);
  });

  it("does not persist a success query with undefined data", () => {
    // Built inline — passing `undefined` to fakeQuery's defaulted param would
    // resolve back to the default, masking the undefined-data case.
    const noData = {
      queryKey: ["stats", "batch", {}],
      state: { status: "success", data: undefined },
    } as unknown as Query;
    expect(shouldDehydrateQuery(noData)).toBe(false);
  });

  it("does not persist unknown query roots (whitelist-by-default)", () => {
    expect(shouldDehydrateQuery(fakeQuery(["foo", "bar"]))).toBe(false);
    expect(shouldDehydrateQuery(fakeQuery(["crashes", 1]))).toBe(false);
  });

  it("does not persist when the key root is not a string", () => {
    expect(shouldDehydrateQuery(fakeQuery([123, "x"]))).toBe(false);
  });
});

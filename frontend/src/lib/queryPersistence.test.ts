import { describe, it, expect, vi } from "vitest";
import type { Query } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { removeOldestQuery } from "@tanstack/react-query-persist-client";
import { shouldDehydrateQuery } from "./queryPersistence";

vi.mock("@tanstack/query-sync-storage-persister", () => ({
  createSyncStoragePersister: vi.fn(() => ({
    persistClient: vi.fn(),
    restoreClient: vi.fn(),
    removeClient: vi.fn(),
  })),
}));

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

  it("excludes stats/batch payloads while keeping other stats queries persisted — M16", () => {
    // stats/batch responses are hundreds of KB each and timelapse multiplies
    // the filter permutations — they must never enter the localStorage snapshot.
    expect(
      shouldDehydrateQuery(fakeQuery(["stats", "batch", { d: "2020-01|2024-12" }])),
    ).toBe(false);
    expect(shouldDehydrateQuery(fakeQuery(["stats", "batch", {}]))).toBe(false);
    // The sibling stats/demographics query stays persisted.
    expect(
      shouldDehydrateQuery(fakeQuery(["stats", "demographics", { d: "2020-01|2024-12" }])),
    ).toBe(true);
  });

  it("never persists non-success queries", () => {
    expect(shouldDehydrateQuery(fakeQuery(["stats", "demographics", {}], "error"))).toBe(false);
    expect(
      shouldDehydrateQuery(fakeQuery(["insight", "alameda", 2023], "pending")),
    ).toBe(false);
  });

  it("does not persist a success query with undefined data", () => {
    // Built inline — passing `undefined` to fakeQuery's defaulted param would
    // resolve back to the default, masking the undefined-data case.
    const noData = {
      queryKey: ["stats", "demographics", {}],
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

describe("persister", () => {
  it("degrades gracefully on QuotaExceededError via removeOldestQuery — M16", () => {
    // Without a retry strategy, a quota error silently stops persistence for
    // the rest of the session. removeOldestQuery evicts the oldest persisted
    // queries and retries the write instead.
    expect(createSyncStoragePersister).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "calsight-query-cache",
        retry: removeOldestQuery,
      }),
    );
  });
});

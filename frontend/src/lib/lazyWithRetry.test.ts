import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  retryDynamicImport,
  importWithChunkReload,
  isChunkLoadError,
  CHUNK_RELOAD_FLAG,
} from "./lazyWithRetry";

const mod = { default: () => null };

const CHUNK_ERROR = new Error(
  "Failed to fetch dynamically imported module: https://calsight.org/assets/StatsPage-abc123.js",
);

describe("retryDynamicImport", () => {
  it("returns the module on first success", async () => {
    const factory = vi.fn().mockResolvedValue(mod);
    await expect(retryDynamicImport(factory, 2, 0)).resolves.toBe(mod);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("retries a failed import and succeeds", async () => {
    const factory = vi
      .fn()
      .mockRejectedValueOnce(new Error("Failed to fetch dynamically imported module"))
      .mockRejectedValueOnce(new Error("chunk 404"))
      .mockResolvedValue(mod);
    await expect(retryDynamicImport(factory, 2, 0)).resolves.toBe(mod);
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it("rethrows after exhausting retries so the error boundary can catch it", async () => {
    const factory = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(retryDynamicImport(factory, 2, 0)).rejects.toThrow("boom");
    expect(factory).toHaveBeenCalledTimes(3);
  });
});

describe("isChunkLoadError", () => {
  it("matches Chrome/Firefox and Safari chunk-load messages", () => {
    expect(isChunkLoadError(CHUNK_ERROR)).toBe(true);
    expect(isChunkLoadError(new Error("Importing a module script failed."))).toBe(true);
  });

  it("does not match unrelated errors or non-Errors", () => {
    expect(isChunkLoadError(new Error("boom"))).toBe(false);
    expect(isChunkLoadError(new Error("stats 500"))).toBe(false);
    expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe("importWithChunkReload (L14: post-deploy chunk 404s)", () => {
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { reload: reloadSpy },
    });
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("resolves normally and re-arms the reload guard on success", async () => {
    sessionStorage.setItem(CHUNK_RELOAD_FLAG, "1"); // leftover from a prior deploy
    const factory = vi.fn().mockResolvedValue(mod);
    await expect(importWithChunkReload(factory, 2, 0)).resolves.toBe(mod);
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(CHUNK_RELOAD_FLAG)).toBeNull();
  });

  it("reloads the page once when the chunk is permanently gone", async () => {
    const factory = vi.fn().mockRejectedValue(CHUNK_ERROR);

    let settled = false;
    const pending = importWithChunkReload(factory, 2, 0).finally(() => {
      settled = true;
    });
    void pending;
    // Let the retries drain (delayMs 0) and the catch branch run.
    await vi.waitFor(() => expect(reloadSpy).toHaveBeenCalledOnce());

    expect(factory).toHaveBeenCalledTimes(3);
    expect(sessionStorage.getItem(CHUNK_RELOAD_FLAG)).toBe("1");
    // The promise must stay pending (the page is reloading) so the Suspense
    // fallback stays up instead of flashing the error boundary.
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);
  });

  it("does NOT reload a second time — guard prevents a reload loop", async () => {
    sessionStorage.setItem(CHUNK_RELOAD_FLAG, "1"); // we already reloaded once
    const factory = vi.fn().mockRejectedValue(CHUNK_ERROR);
    await expect(importWithChunkReload(factory, 2, 0)).rejects.toThrow(
      /Failed to fetch dynamically imported module/,
    );
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("does not reload for non-chunk errors — those go to the error boundary", async () => {
    const factory = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(importWithChunkReload(factory, 2, 0)).rejects.toThrow("boom");
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(CHUNK_RELOAD_FLAG)).toBeNull();
  });
});

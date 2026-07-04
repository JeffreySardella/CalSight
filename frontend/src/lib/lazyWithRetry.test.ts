import { describe, it, expect, vi } from "vitest";
import { retryDynamicImport } from "./lazyWithRetry";

const mod = { default: () => null };

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

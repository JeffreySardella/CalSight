import { describe, it, expect, vi, beforeEach } from "vitest";
import { safeGetItem, safeSetItem, safeRemoveItem } from "./safeStorage";

describe("safeStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("safeSetItem writes to localStorage", () => {
    safeSetItem("key", "value");
    expect(localStorage.getItem("key")).toBe("value");
  });

  it("safeGetItem reads from localStorage", () => {
    localStorage.setItem("key", "value");
    expect(safeGetItem("key")).toBe("value");
  });

  it("safeGetItem returns null for missing key", () => {
    expect(safeGetItem("missing")).toBeNull();
  });

  it("safeRemoveItem removes from localStorage", () => {
    localStorage.setItem("key", "value");
    safeRemoveItem("key");
    expect(localStorage.getItem("key")).toBeNull();
  });

  it("safeSetItem swallows SecurityError", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => safeSetItem("key", "value")).not.toThrow();
    spy.mockRestore();
  });

  it("safeSetItem swallows QuotaExceededError", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => safeSetItem("key", "value")).not.toThrow();
    spy.mockRestore();
  });

  it("safeGetItem returns null on SecurityError", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(safeGetItem("key")).toBeNull();
    spy.mockRestore();
  });

  it("safeRemoveItem swallows errors", () => {
    const spy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => safeRemoveItem("key")).not.toThrow();
    spy.mockRestore();
  });
});

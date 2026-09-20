import { describe, it, expect, vi, afterEach } from "vitest";
import {
  decideUpdate,
  armUpdateGate,
  notifyRouteChange,
  resetUpdateGate,
} from "./swUpdateGate";

afterEach(() => {
  resetUpdateGate();
  vi.useRealTimers();
});

function setVisibility(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => value,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("decideUpdate", () => {
  const fresh = { applied: false, expired: false };

  it("applies when the tab goes to the background", () => {
    expect(decideUpdate("hidden", fresh)).toBe("apply");
  });

  it("applies on a route change", () => {
    expect(decideUpdate("route-change", fresh)).toBe("apply");
  });

  it("never applies on expiry — the update waits for the next visit", () => {
    expect(decideUpdate("expired", fresh)).toBe("ignore");
  });

  it("ignores every trigger once the grace window has expired", () => {
    const expired = { applied: false, expired: true };
    expect(decideUpdate("hidden", expired)).toBe("ignore");
    expect(decideUpdate("route-change", expired)).toBe("ignore");
  });

  it("ignores every trigger once a reload has already been applied", () => {
    const applied = { applied: true, expired: false };
    expect(decideUpdate("hidden", applied)).toBe("ignore");
    expect(decideUpdate("route-change", applied)).toBe("ignore");
  });
});

describe("armUpdateGate", () => {
  it("does not reload while the tab stays visible and still", () => {
    const apply = vi.fn();
    armUpdateGate(apply);
    expect(apply).not.toHaveBeenCalled();
  });

  it("reloads when the tab is hidden", () => {
    const apply = vi.fn();
    armUpdateGate(apply);
    setVisibility("hidden");
    expect(apply).toHaveBeenCalledTimes(1);
    setVisibility("visible");
  });

  it("reloads on the next route change", () => {
    const apply = vi.fn();
    armUpdateGate(apply);
    notifyRouteChange();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("reloads at most once even when both triggers fire", () => {
    const apply = vi.fn();
    armUpdateGate(apply);
    notifyRouteChange();
    setVisibility("hidden");
    notifyRouteChange();
    expect(apply).toHaveBeenCalledTimes(1);
    setVisibility("visible");
  });

  it("gives up after the grace window and leaves it for the next visit", () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    armUpdateGate(apply, 1000);
    vi.advanceTimersByTime(1001);
    notifyRouteChange();
    setVisibility("hidden");
    expect(apply).not.toHaveBeenCalled();
    setVisibility("visible");
  });

  it("ignores a route change when nothing armed the gate", () => {
    expect(() => notifyRouteChange()).not.toThrow();
  });
});

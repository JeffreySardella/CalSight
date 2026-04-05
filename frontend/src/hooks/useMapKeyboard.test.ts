import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMapKeyboard } from "./useMapKeyboard";

function createMockMap() {
  return {
    panBy: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    setView: vi.fn(),
    getBounds: vi.fn(() => ({ contains: vi.fn(() => true) })),
    removeLayer: vi.fn(),
  } as unknown as import("leaflet").Map;
}

function fireKey(key: string, opts: Partial<KeyboardEventInit> = {}) {
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...opts }));
}

describe("useMapKeyboard", () => {
  const counties = ["Alameda", "Butte", "Fresno", "Los Angeles", "Ventura"];
  let map: ReturnType<typeof createMockMap>;
  let onFocusCounty: ReturnType<typeof vi.fn<(name: string | null) => void>>;
  let onSelectCounty: ReturnType<typeof vi.fn<(name: string) => void>>;
  let onCloseOverlay: ReturnType<typeof vi.fn<() => void>>;
  let onToggleHelp: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    map = createMockMap();
    onFocusCounty = vi.fn<(name: string | null) => void>();
    onSelectCounty = vi.fn<(name: string) => void>();
    onCloseOverlay = vi.fn<() => void>();
    onToggleHelp = vi.fn<() => void>();
  });

  function renderKeyboard(overrides: Record<string, unknown> = {}) {
    return renderHook(() =>
      useMapKeyboard({
        map,
        counties,
        focusedCounty: null,
        onFocusCounty,
        onSelectCounty,
        onCloseOverlay,
        onToggleHelp,
        ...overrides,
      })
    );
  }

  it("Tab focuses the first county when none is focused", () => {
    renderKeyboard();
    fireKey("Tab");
    expect(onFocusCounty).toHaveBeenCalledWith("Alameda");
  });

  it("Tab advances to next county", () => {
    renderKeyboard({ focusedCounty: "Butte" });
    fireKey("Tab");
    expect(onFocusCounty).toHaveBeenCalledWith("Fresno");
  });

  it("Tab wraps from last to first county", () => {
    renderKeyboard({ focusedCounty: "Ventura" });
    fireKey("Tab");
    expect(onFocusCounty).toHaveBeenCalledWith("Alameda");
  });

  it("Shift+Tab goes to previous county", () => {
    renderKeyboard({ focusedCounty: "Fresno" });
    fireKey("Tab", { shiftKey: true });
    expect(onFocusCounty).toHaveBeenCalledWith("Butte");
  });

  it("Enter selects the focused county", () => {
    renderKeyboard({ focusedCounty: "Los Angeles" });
    fireKey("Enter");
    expect(onSelectCounty).toHaveBeenCalledWith("Los Angeles");
  });

  it("Escape calls onCloseOverlay", () => {
    renderKeyboard();
    fireKey("Escape");
    expect(onCloseOverlay).toHaveBeenCalled();
  });

  it("Arrow keys pan the map", () => {
    renderKeyboard();
    fireKey("ArrowUp");
    expect(map.panBy).toHaveBeenCalledWith([0, -100], { animate: true });
    fireKey("ArrowDown");
    expect(map.panBy).toHaveBeenCalledWith([0, 100], { animate: true });
    fireKey("ArrowLeft");
    expect(map.panBy).toHaveBeenCalledWith([-100, 0], { animate: true });
    fireKey("ArrowRight");
    expect(map.panBy).toHaveBeenCalledWith([100, 0], { animate: true });
  });

  it("+ zooms in and - zooms out", () => {
    renderKeyboard();
    fireKey("+");
    expect(map.zoomIn).toHaveBeenCalledWith(1, { animate: true });
    fireKey("-");
    expect(map.zoomOut).toHaveBeenCalledWith(1, { animate: true });
  });

  it("? toggles help", () => {
    renderKeyboard();
    fireKey("?");
    expect(onToggleHelp).toHaveBeenCalled();
  });

  it("ignores keys when an input is focused", () => {
    renderKeyboard();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireKey("Tab");
    fireKey("Escape");
    expect(onFocusCounty).not.toHaveBeenCalled();
    expect(onCloseOverlay).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it("ignores keys when enabled is false", () => {
    renderKeyboard({ enabled: false });
    fireKey("Tab");
    fireKey("Escape");
    expect(onFocusCounty).not.toHaveBeenCalled();
    expect(onCloseOverlay).not.toHaveBeenCalled();
  });
});

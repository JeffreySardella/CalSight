import "@testing-library/jest-dom/vitest";

// jsdom ships no matchMedia. Components that branch on viewport width
// (useIsMobile) would throw on mount; default them to "not a phone" and let
// individual tests override window.matchMedia when they need the touch branch.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import Layout from "./Layout";

// Layout's chrome (NavBar/Footer/BottomTabBar) pulls in the whole app's
// context providers, none of which matter to the scroll-on-navigate
// behavior under test — stub them out so this stays a focused test.
vi.mock("./NavBar", () => ({ default: () => null }));
vi.mock("./Footer", () => ({ default: () => null }));
vi.mock("./BottomTabBar", () => ({ default: () => null }));
vi.mock("./ui/OfflineIndicator", () => ({ OfflineIndicator: () => null }));

function Nav() {
  const navigate = useNavigate();
  return (
    <div>
      {/* Different pathname — the map writes viewport state to the query
          string on every pan/zoom, so pathname (not full location) is what
          must gate the reset. */}
      <button onClick={() => navigate("/water")}>go-to-water</button>
      {/* Same pathname, query string only. */}
      <button onClick={() => navigate("?foo=bar")}>set-query</button>
      {/* Different pathname but with a #hash — the hash-scroll effect owns
          this case, not the plain scroll-to-top. */}
      <button onClick={() => navigate("/water#reservoirs")}>go-to-water-hash</button>
    </div>
  );
}

function renderApp(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/stats" element={<><div>stats page</div><Nav /></>} />
          <Route path="/water" element={<div>water page</div>} />
          <Route path="/ask" element={<div>ask page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("Layout scroll-on-navigate", () => {
  let scrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scrolls to top when the pathname changes", async () => {
    renderApp("/stats");
    scrollTo.mockClear(); // drop the initial-mount call, not what's under test
    await userEvent.click(screen.getByText("go-to-water"));
    expect(await screen.findByText("water page")).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("does not scroll for a query-string-only change", async () => {
    renderApp("/stats");
    scrollTo.mockClear();
    await userEvent.click(screen.getByText("set-query"));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does not scroll to top when the destination carries a #hash", async () => {
    renderApp("/stats");
    scrollTo.mockClear();
    await userEvent.click(screen.getByText("go-to-water-hash"));
    expect(await screen.findByText("water page")).toBeInTheDocument();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe("Layout bottom-nav clearance on /ask", () => {
  // The fixed BottomTabBar (h-14 + env(safe-area-inset-bottom)) grows on
  // devices with a gesture-nav/home-indicator inset. A flat pb-14 here
  // under-reserves space by that inset and the sticky input bar's send
  // button ends up clipped behind the nav (reported: "Ask AI cut off on
  // mobile"). The wrapper must reserve the same env()-aware amount.
  it("reserves env(safe-area-inset-bottom) below the fixed bottom nav", () => {
    const { container } = renderApp("/ask");
    const wrapper = container.querySelector(".page-enter");
    expect(wrapper?.className).toContain("pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))]");
  });
});

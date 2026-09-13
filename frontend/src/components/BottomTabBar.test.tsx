import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import Layout from "./Layout";

// The tab bar hides at ONE breakpoint. Every bottom offset that keeps content
// clear of it must reset at that same breakpoint. Tablets (768–1023px) have
// no desktop nav, so when the offsets drifted to `md:` the bar covered the
// county card's buttons, the Ask textarea and every footer.
function hiddenPrefix(el: Element): string {
  const m = /(?:^|\s)(\w+):hidden(?:\s|$)/.exec(el.className);
  if (!m) throw new Error("BottomTabBar has no responsive hidden class");
  return m[1];
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<p>map</p>} />
          <Route path="/ask" element={<p>ask</p>} />
          <Route path="/about" element={<p>about</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("BottomTabBar breakpoint agreement", () => {
  it("content pages, the footer, the map and Ask all drop their bar offset at the bar's own breakpoint", () => {
    renderAt("/about");
    const bp = hiddenPrefix(screen.getByRole("navigation", { name: "Mobile navigation" }));
    const shell = screen.getByRole("main").parentElement!;
    expect(shell.className).toContain(`${bp}:pb-0`);
    expect(shell.className).not.toMatch(/\bmd:pb-0\b/);
    expect(screen.getByRole("contentinfo").className).toMatch(new RegExp(`\\b${bp}:pb-\\d+`));
    cleanup();

    renderAt("/");
    expect(screen.getByRole("main").className).toContain(`${bp}:pb-0`);
    cleanup();

    renderAt("/ask");
    expect(screen.getByRole("main").parentElement!.className).toContain(`${bp}:pb-0`);
  });
});

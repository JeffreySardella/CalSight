import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import Layout from "../components/Layout";
import StatsPage from "./StatsPage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DATA_STORIES } from "../lib/dashboard/stories";
import { PRESETS } from "../lib/dashboard/presets";
import { ThemeProvider } from "../context/ThemeContext";
import { CustomThemeProvider } from "../context/CustomThemeContext";

// jsdom lacks matchMedia; ThemeProvider, useIsMobile, and chart components read it.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Regression test for a real bug: Layout is the parent route element, so its
// title effect runs AFTER StatsPage's (React flushes child effects first),
// and used to unconditionally stamp "Statistics Dashboard — CalSight" over
// whatever StatsPage/MetaTags had just set for a story or preset deep link.
// A unit test of pageSeo.ts in isolation never saw this — it only shows up
// when Layout and the routed page are actually mounted together, which is
// what this file does.
//
// Every data hook StatsPage owns goes through `fetch` (useStats,
// useDashboardData, useCorrelationData, useFunFacts, ...); stubbing fetch to
// reject lets every query settle into its error state quickly instead of
// hitting a real network, without mocking a dozen hooks individually. The
// title/description effects run regardless of whether the data loaded.
function renderStatsAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      {/* A story's chart blocks render through ChartCard, which reads the
          user's chart-palette customization — without this provider pair
          ChartCard throws (caught by Layout's ErrorBoundary) and the whole
          page, MetaTags included, never mounts. */}
      <ThemeProvider>
        <CustomThemeProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/stats" element={<StatsPage />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </CustomThemeProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no network in tests")));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("document.title on /stats (Layout + StatsPage, routed together)", () => {
  it("titles a story deep link with the story, not the generic dashboard title", async () => {
    const story = DATA_STORIES[0];
    renderStatsAt(`/stats?story=${story.id}`);
    await waitFor(() => expect(document.title).toContain(story.title));
    expect(document.title).toBe(`${story.title} — CalSight`);
  });

  it("titles a preset deep link with the preset", async () => {
    renderStatsAt("/stats?preset=dui");
    await waitFor(() => expect(document.title).toBe(`${PRESETS.dui.label} — CalSight`));
  });

  it("plain /stats keeps the generic dashboard title", async () => {
    renderStatsAt("/stats");
    await waitFor(() => expect(document.title).toBe("Statistics Dashboard — CalSight"));
  });

  it("title AND meta description reset after leaving a story via Back", async () => {
    const story = DATA_STORIES[0];
    const user = userEvent.setup();
    renderStatsAt(`/stats?story=${story.id}`);

    await waitFor(() => expect(document.title).toBe(`${story.title} — CalSight`));
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(story.subtitle);

    await user.click(await screen.findByRole("button", { name: /back to stories/i }));

    // setActiveStory clears the ?story= param it set on entry, so Layout
    // (URL-driven) and MetaTags (state-driven) both fall back to the plain
    // preset defaults instead of one of them staying stuck on the story.
    await waitFor(() => expect(document.title).toBe("Statistics Dashboard — CalSight"));
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).not.toBe(story.subtitle);
  });
});

import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:5174";

// Requires the local stack: vite on :5174 (playwright.config webServer) plus a
// backend whose /api/stats/highways returns rows (crashes.route_number must be
// populated) and the generated frontend/public/ca-highways.geojson present.
// Without that geometry/data the layer draws nothing and this test fails.
test("toggle highway-danger layer draws lines and clicking one opens its stats", async ({ page }) => {
  test.skip(!process.env.VITE_API_TARGET, "needs a backend: /api/stats/highways supplies the per-route stats the click opens");

  // Suppress the first-visit intro modal, which otherwise covers the UI.
  await page.addInitScript(() => localStorage.setItem("calsight-intro-seen", "1"));

  await page.goto(`${BASE_URL}/`);

  // Open the Layers panel from the icon rail.
  await page.getByRole("button", { name: "Layers" }).click();

  // The Highway Danger toggle is a labeled switch — target it by role + name.
  const highwayToggle = page.getByRole("switch", { name: "Highway Danger" });
  await expect(highwayToggle).toHaveAttribute("aria-checked", "false");
  await highwayToggle.click();
  await expect(highwayToggle).toHaveAttribute("aria-checked", "true");

  // The layer draws into its own pane (HIGHWAY_PANE = "highwayDangerPane" in
  // HighwayDangerLayer.tsx, stacked above the county choropleth); Leaflet
  // names it .leaflet-highwayDanger-pane, not the default overlay pane.
  // Each route is drawn twice: a non-interactive white casing underneath and
  // the colored interactive line on top. Pick an interactive line that has a
  // stats row (no-data routes are grey #9ca3af and ignore clicks).
  const line = page
    .locator('.leaflet-highwayDanger-pane path.leaflet-interactive:not([stroke="#9ca3af"])')
    .first();
  await expect(line).toBeVisible({ timeout: 15000 });

  // A coordinate click at the path's bounding-box centre usually misses a
  // long curved highway, so fire the click on the element itself; Leaflet
  // routes it to the feature's handler via the map container listener.
  await line.dispatchEvent("click");

  // The highway side panel shows the per-route stats. /fatality rate/i is
  // ambiguous now (the Layers panel has a "Fatality Rate" color-by button and a
  // "Fatality rate %" measure), so assert on a stat label only the side panel
  // renders on the map page.
  await expect(page.getByText("Crashes per mile", { exact: true })).toBeVisible();
});

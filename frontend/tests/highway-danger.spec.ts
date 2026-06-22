import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:5174";

// Requires the local stack: vite on :5174 (playwright.config webServer) plus a
// backend whose /api/stats/highways returns rows (crashes.route_number must be
// populated) and the generated frontend/public/ca-highways.geojson present.
// Without that geometry/data the layer draws nothing and this test fails.
test("toggle highway-danger layer draws lines and clicking one opens its stats", async ({ page }) => {
  // Suppress the first-visit intro modal, which otherwise covers the UI.
  await page.addInitScript(() => localStorage.setItem("calsight-intro-seen", "1"));

  await page.goto(`${BASE_URL}/`);

  // Open the Layers panel from the icon rail.
  await page.getByRole("button", { name: "Layers" }).click();

  // The Highway Danger toggle is an unlabeled button in its row; target the
  // row by its text, then click the toggle inside it.
  const highwayRow = page
    .locator("div.flex.justify-between")
    .filter({ hasText: "Highway Danger" })
    .first();
  await highwayRow.getByRole("button").click();

  // Leaflet draws polylines as <path> in the overlay pane.
  const line = page.locator(".leaflet-overlay-pane path").first();
  await expect(line).toBeVisible({ timeout: 15000 });

  await line.click({ force: true });

  // The highway side panel shows the per-route stats.
  await expect(page.getByText(/fatality rate/i)).toBeVisible();
});

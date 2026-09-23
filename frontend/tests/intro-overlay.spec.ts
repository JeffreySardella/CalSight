import { test, expect, type Page } from "@playwright/test";

const BASE_URL = "http://localhost:5174";

// Hermetic e2e for the map page's first-visit gates (components/map/
// IntroOverlay.tsx and FilteredUrlPrompt.tsx). Both are pure client state —
// no backend needed — so every /api call 404s harmlessly, the same way the
// rest of the map already degrades without one (see useChoroplethData's
// isError handling).

async function mockMapApi(page: Page) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, body: "not mocked" }));
}

test.beforeEach(async ({ page }) => {
  await mockMapApi(page);
});

test("intro overlay: choosing Advanced dismisses it", async ({ page }) => {
  await page.goto(`${BASE_URL}/`);

  const dialog = page.getByRole("dialog", { name: "Welcome to CalSight" });
  await expect(dialog).toBeVisible();

  await page.getByRole("button", { name: "Advanced" }).click();
  await expect(dialog).toBeHidden();
});

test("intro overlay: Skip dismisses it without waiting on Simple or Advanced", async ({ page }) => {
  await page.goto(`${BASE_URL}/`);

  const dialog = page.getByRole("dialog", { name: "Welcome to CalSight" });
  await expect(dialog).toBeVisible();

  await page.getByRole("button", { name: /skip, just show me the map/i }).click();
  await expect(dialog).toBeHidden();

  // The seen-flag is the same one Simple/Advanced set, so a reload doesn't
  // bring the intro back.
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Welcome to CalSight" })).toBeHidden();
});

test("a filtered URL shows the Filtered URL prompt, and dismissing it makes the map interactive", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("calsight-intro-seen", "1"));
  await page.goto(`${BASE_URL}/?severity=fatal`);

  const prompt = page.getByRole("dialog", { name: "Filtered URL" });
  await expect(prompt).toBeVisible();
  await expect(prompt.getByText("Fatal", { exact: true })).toBeVisible();

  await prompt.getByRole("button", { name: "View Filtered" }).click();
  await expect(prompt).toBeHidden();

  // The map is interactive again: the Layers panel opens and responds.
  await page.getByRole("button", { name: "Layers" }).click();
  await expect(page.getByRole("switch", { name: "Highway Danger" })).toBeVisible();
});

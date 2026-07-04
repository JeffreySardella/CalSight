import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:5174";

// Real-browser verification of the Story Canvas focus trap (audit M-F17).
// jsdom can't move focus on a real Tab keypress, so the unit tests only prove
// the handler logic; this drives actual Tab / Shift+Tab / Escape in Chromium.
// Hermetic: the Story Canvas is pure client state, so no backend/AI is needed.

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

test("Story Canvas traps Tab focus inside the dialog and closes on Escape", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("calsight-intro-seen", "1");
    localStorage.setItem("calsight-insight-seen", "1");
  });

  await page.goto(`${BASE_URL}/ask`);
  await page.getByRole("button", { name: /open story canvas/i }).click();

  const dialog = page.getByRole("dialog", { name: /story/i });
  await expect(dialog).toBeVisible();

  // Add a note so the dialog has several focusable controls to cycle through.
  await page.getByRole("button", { name: "+ Add note" }).click();

  const focusables = dialog.locator(FOCUSABLE);
  const count = await focusables.count();
  expect(count).toBeGreaterThan(1);
  const first = focusables.first();
  const last = focusables.last();

  // Tab from the last focusable wraps back to the first.
  await last.focus();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();

  // Shift+Tab from the first wraps to the last.
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();

  // Tabbing forward many times never escapes the dialog.
  for (let i = 0; i < count + 3; i++) await page.keyboard.press("Tab");
  const stillTrapped = await page.evaluate(
    () => document.activeElement?.closest('[role="dialog"]') != null,
  );
  expect(stillTrapped).toBe(true);

  // Escape closes it.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

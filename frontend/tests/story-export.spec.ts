import { test, expect } from "@playwright/test";
import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";

const BASE_URL = "http://localhost:5174";

// Real (non-mocked) export smoke check. The blank-export regression (PR #332)
// produced a PNG of the CORRECT dimensions but entirely white, because
// html-to-image kept the off-screen capture offset. Every unit test mocked
// html-to-image, so the suite stayed green while the real file was blank.
// This test runs the actual export pipeline in a browser and inspects the
// downloaded PNG's pixels to prove real content was rasterized.
//
// Requires the local stack: vite on :5174 (playwright.config webServer). It does
// NOT need the backend/AI — the story is built from a note + title, which is
// pure client state, so the export render path is exercised hermetically.

/** Decode a PNG's IDAT stream and count how many distinct byte values it holds.
 * A solid white image inflates to a near-uniform stream (filter bytes + 0xFF),
 * so a low distinct-value count means "blank"; anti-aliased text/colors push it
 * far higher. We never need to fully de-filter — distinct-value entropy is a
 * robust blank/non-blank discriminator. */
function pngContentEntropy(bytes: Buffer): { distinct: number; midtone: number } {
  // Skip 8-byte signature, walk chunks, concatenate IDAT payloads.
  let off = 8;
  const idat: Buffer[] = [];
  while (off < bytes.length) {
    const len = bytes.readUInt32BE(off);
    const type = bytes.toString("ascii", off + 4, off + 8);
    const start = off + 8;
    if (type === "IDAT") idat.push(bytes.subarray(start, start + len));
    if (type === "IEND") break;
    off = start + len + 4; // + CRC
  }
  const raw = inflateSync(Buffer.concat(idat));
  const seen = new Set<number>();
  let midtone = 0; // bytes strictly between pure black and pure white
  for (const b of raw) {
    seen.add(b);
    if (b > 0 && b < 255) midtone++;
  }
  return { distinct: seen.size, midtone };
}

test("Story Canvas export produces a non-blank PNG", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("calsight-intro-seen", "1");
    localStorage.setItem("calsight-insight-seen", "1");
  });

  await page.goto(`${BASE_URL}/ask`);

  // Open the Story Canvas panel.
  await page.getByRole("button", { name: /open story canvas/i }).click();

  // Build a one-block story from a note (no AI/backend needed).
  await page.getByRole("button", { name: "+ Add note" }).click();
  await page.getByRole("textbox", { name: "Story note" })
    .fill("Smoke-test content — this text must render in the export.");
  await page.getByRole("textbox", { name: "Story title" })
    .fill("Export Smoke Test");

  // Export PNG and capture the download.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export PNG" }).click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const path = await download.path();
  const bytes = readFileSync(path);

  // Valid PNG signature.
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

  // The blank-export bug yields an all-white raster: very few distinct byte
  // values and essentially zero midtone (anti-aliased) pixels. Real rendered
  // text produces many distinct values and plenty of midtones.
  const { distinct, midtone } = pngContentEntropy(bytes);
  expect(distinct).toBeGreaterThan(16);
  expect(midtone).toBeGreaterThan(100);
});

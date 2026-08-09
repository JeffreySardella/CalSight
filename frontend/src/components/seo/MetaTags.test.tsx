import { describe, it, expect } from "vitest";
import { buildOgImageUrl } from "./MetaTags";

// Vite's ?raw / ?url loaders keep this in browser-land — the frontend tsconfig
// has no Node types, so fs/path would typecheck-fail even though vitest runs
// them fine. ?url also proves the asset resolves through the bundler, which is
// the thing that actually has to work at deploy time.
import indexHtml from "../../../index.html?raw";
import ogDefaultUrl from "../../../public/og-default.png?url";

/**
 * Social cards are the most-seen asset on the product and the easiest to break
 * silently — nothing in the app renders them, so a dead URL only shows up when
 * someone pastes a link into Slack. og.calsight.org has no DNS record, so every
 * og:image pointing there rendered a broken thumbnail everywhere.
 */
describe("social card image", () => {
  it("resolves a bundled fallback image through the build", () => {
    expect(ogDefaultUrl).toBeTruthy();
    expect(ogDefaultUrl).toContain("og-default");
  });

  it("never points crawler meta tags at the undeployed OG worker", () => {
    // index.html is what crawlers read — they don't run JS, so a dead URL here
    // is the one that actually reaches Twitter/Slack/iMessage.
    const ogTags = indexHtml
      .split("\n")
      .filter((line: string) => /og:image"|twitter:image"/.test(line));

    expect(ogTags.length).toBeGreaterThan(0);
    for (const tag of ogTags) {
      expect(tag).not.toContain("og.calsight.org");
      expect(tag).toContain("/og-default.png");
    }
  });

  it("falls back to the bundled image while the OG worker is undeployed", () => {
    const url = buildOgImageUrl({ preset: "overview", metric: "crashes" });
    expect(url).not.toContain("og.calsight.org");
    expect(url).toContain("/og-default.png");
  });
});

/** Regression: every Material Symbols icon used in the app must be in the
 *  index.html font-subset URL (`icon_names=`), or it renders as raw ligature
 *  text like "CONTENT_COPY" in prod. This has now bitten twice (2026-06-28
 *  audit defect, 2026-07-13 copy/export/rebuilding-banner icons) because the
 *  subset is easy to forget when adding an icon. This test scans the source
 *  the same way a reviewer would and fails with the exact names to add.
 */
import { describe, it, expect } from "vitest";
import indexHtml from "../../index.html?raw";

// Icon names rendered inside a material-symbols span (same-line or with the
// name on its own line), or passed as an `icon` prop/option — EmptyState and
// friends render those in such a span.
const SPAN_RE = /material-symbols[^>]*>\s*\{?["']?([a-z][a-z0-9_]+)["']?\}?\s*</g;
const PROP_RE = /\bicon\s*[:=]\s*["']([a-z][a-z0-9_]+)["']/g;
// The prop regex can catch stray identifiers; ignore ones that are clearly
// not Material Symbols names.
const FALSE_POSITIVES = new Set(["icon", "in", "true", "false"]);

const sources = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function subsetNames(): string[] {
  const m = indexHtml.match(/icon_names=([^"&]+)/);
  expect(m, "icon_names= subset parameter present in index.html").toBeTruthy();
  return m![1].split(",");
}

describe("Material Symbols font subset", () => {
  it("includes every icon name used in the source", () => {
    const subset = new Set(subsetNames());

    const used = new Set<string>();
    for (const [path, text] of Object.entries(sources)) {
      if (path.includes(".test.")) continue;
      for (const re of [SPAN_RE, PROP_RE]) {
        re.lastIndex = 0;
        for (let match; (match = re.exec(text)); ) {
          if (!FALSE_POSITIVES.has(match[1]) && match[1].length >= 3) used.add(match[1]);
        }
      }
    }
    // The scan must actually be scanning something.
    expect(used.size).toBeGreaterThan(20);

    const missing = [...used].filter((n) => !subset.has(n)).sort();
    expect(missing, `add these to index.html icon_names (alphabetically): ${missing.join(",")}`).toEqual([]);
  });

  it("keeps the subset list alphabetically sorted (Google Fonts requirement)", () => {
    const names = subsetNames();
    expect(names).toEqual([...names].sort());
  });
});

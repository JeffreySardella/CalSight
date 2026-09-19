import { describe, it, expect } from "vitest";
import indexHtml from "../../../index.html?raw";

// The WebSite + Dataset JSON-LD in index.html is what crawlers see before any
// JS runs (unlike the per-page blocks MetaTags.tsx injects at runtime), so a
// typo here is invisible until Google's Rich Results report catches it days
// later. This just proves the block parses and the required fields are the
// ones actually documented in docs/DATA_METHODOLOGY.md / the About page.
describe("index.html JSON-LD", () => {
  function extractJsonLd(): unknown {
    const match = indexHtml.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    );
    expect(match).not.toBeNull();
    return JSON.parse(match![1]);
  }

  it("parses as valid JSON with a WebSite and a Dataset entry", () => {
    const data = extractJsonLd() as { "@context": string; "@graph": Array<Record<string, unknown>> };
    expect(data["@context"]).toBe("https://schema.org");
    const types = data["@graph"].map((entry) => entry["@type"]);
    expect(types).toContain("WebSite");
    expect(types).toContain("Dataset");
  });

  it("Dataset states the real license, free access, and 2001-to-present coverage", () => {
    const data = extractJsonLd() as { "@graph": Array<Record<string, unknown>> };
    const dataset = data["@graph"].find((e) => e["@type"] === "Dataset")!;
    expect(dataset.license).toBe("https://www.ca.gov/about/public-records-act/");
    expect(dataset.isAccessibleForFree).toBe(true);
    expect(dataset.temporalCoverage).toMatch(/^2001-01-01/);
    expect((dataset.spatialCoverage as { name: string }).name).toContain("California");
    // Source attribution must name the two crash systems the About page and
    // DATA_METHODOLOGY.md actually document.
    expect(dataset.description).toContain("SWITRS");
    expect(dataset.description).toContain("California Crash Reporting System (CCRS");
    expect(dataset.description).toContain("California Highway Patrol");
    expect(dataset.description).toContain("Census ACS");
  });

  it("Dataset and WebSite credit CalSight itself, not a personal name", () => {
    const data = extractJsonLd() as { "@graph": Array<Record<string, unknown>> };
    const dataset = data["@graph"].find((e) => e["@type"] === "Dataset")!;
    const website = data["@graph"].find((e) => e["@type"] === "WebSite")!;
    expect((dataset.creator as { name: string }).name).toBe("CalSight");
    expect((website.publisher as { name: string }).name).toBe("CalSight");
    expect(JSON.stringify(dataset)).not.toMatch(/Sardella|Shkrabak|Longarini|Kabel/);
  });
});

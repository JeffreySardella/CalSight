import { describe, it, expect, vi, afterEach } from "vitest";
import { BASEMAPS, CARTO_API_KEY, CARTO_BASEMAP, ESRI_BASEMAP, OSM_BASEMAP } from "./basemaps";
import headers from "../../../public/_headers?raw";

describe("basemaps", () => {
  it("never leads with unkeyed CARTO", () => {
    // Unkeyed CARTO tiles come back stamped "API KEY REQUIRED" across the whole
    // map, which is worse than a different-looking but clean basemap.
    if (!CARTO_API_KEY) {
      expect(BASEMAPS[0].id).not.toBe("carto");
      expect(BASEMAPS.some((b) => b.id === "carto")).toBe(false);
    } else {
      expect(BASEMAPS[0].id).toBe("carto");
    }
  });

  it("always offers a fallback provider", () => {
    expect(BASEMAPS.length).toBeGreaterThan(1);
  });

  it("appends the CARTO key as a query param when one is configured", () => {
    const url = CARTO_BASEMAP.base(true);
    if (CARTO_API_KEY) {
      expect(url).toContain(`api_key=${encodeURIComponent(CARTO_API_KEY)}`);
    } else {
      expect(url).not.toContain("api_key");
    }
  });

  it("uses light/dark variants of each style", () => {
    for (const basemap of [CARTO_BASEMAP, ESRI_BASEMAP]) {
      expect(basemap.base(true)).not.toBe(basemap.base(false));
      expect(basemap.labels?.(true)).not.toBe(basemap.labels?.(false));
    }
  });

  it("gives every provider a tile template Leaflet can fill in", () => {
    for (const basemap of BASEMAPS) {
      for (const url of [basemap.base(true), basemap.base(false)]) {
        expect(url).toMatch(/^https:\/\//);
        expect(url).toContain("{z}");
        expect(url).toContain("{x}");
        expect(url).toContain("{y}");
      }
    }
  });

  it("carries attribution for every provider", () => {
    for (const basemap of BASEMAPS) {
      expect(basemap.attribution.length).toBeGreaterThan(0);
    }
  });

  it("declares a native zoom ceiling so deep zooms upscale instead of blanking", () => {
    // The map allows zoom 18 for raw crash detail; Esri's canvas stops at 16.
    for (const basemap of BASEMAPS) {
      expect(basemap.maxNativeZoom).toBeGreaterThanOrEqual(16);
    }
    expect(ESRI_BASEMAP.maxNativeZoom).toBe(16);
  });

  it("bakes labels into the last-resort provider", () => {
    expect(OSM_BASEMAP.labels).toBeNull();
    expect(BASEMAPS[BASEMAPS.length - 1].id).toBe("osm");
  });
});

describe("basemaps with a CARTO key configured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadWithKey(key: string) {
    vi.stubEnv("VITE_CARTO_API_KEY", key);
    vi.resetModules();
    return import("./basemaps");
  }

  it("leads with CARTO and keys every style", async () => {
    const mod = await loadWithKey("abc123");
    expect(mod.BASEMAPS[0].id).toBe("carto");
    expect(mod.BASEMAPS[0].base(true)).toContain("api_key=abc123");
    expect(mod.BASEMAPS[0].base(false)).toContain("api_key=abc123");
    expect(mod.BASEMAPS[0].labels!(true)).toContain("api_key=abc123");
    expect(mod.BASEMAPS[0].labels!(false)).toContain("api_key=abc123");
  });

  it("keeps the keyless providers behind it as a fallback", async () => {
    const mod = await loadWithKey("abc123");
    expect(mod.BASEMAPS.map((b) => b.id)).toEqual(["carto", "esri-canvas", "osm"]);
  });

  it("escapes a key with URL-significant characters", async () => {
    const mod = await loadWithKey("a b&c");
    expect(mod.BASEMAPS[0].base(true)).toContain("api_key=a%20b%26c");
  });
});

/**
 * The tile hosts are only half the change: Cloudflare Pages serves a CSP from
 * `public/_headers`, and its allowlists named only CARTO. Adding a provider
 * without adding its host means every tile is blocked before it leaves the
 * browser — the map falls through the whole list and ends up with no basemap
 * at all, which is exactly what the first deploy of this list did.
 *
 * Both directives matter, and img-src alone is the trap: a `<img>` tile is
 * governed by `img-src`, but the service worker re-issues that same request as
 * a `fetch()` inside its CacheFirst route, and *that* is governed by
 * `connect-src`. So a host in img-src but not connect-src works on a first
 * visit and fails for every returning visitor, with no network fallback —
 * which is how the map shipped with no basemap for anyone who had the site
 * cached. Nothing else in CI loads a tile, so check both allowlists here.
 */
describe("basemap hosts are allowed by the CSP", () => {
  const csp = /Content-Security-Policy:(.*)/.exec(headers)?.[1] ?? "";
  const directive = (name: string) =>
    new RegExp(`${name} ([^;]*)`).exec(csp)?.[1]?.trim().split(/\s+/) ?? [];
  const imgSrc = directive("img-src");
  const connectSrc = directive("connect-src");

  function allowed(url: string, sources: string[]): boolean {
    // Leaflet's {s} subdomain placeholder isn't a legal hostname character.
    const host = new URL(url.replace("{s}", "a")).host;
    return sources.some((source) => {
      if (!source.startsWith("https://")) return false;
      const pattern = source.slice("https://".length);
      return pattern.startsWith("*.") ? host.endsWith(pattern.slice(1)) : host === pattern;
    });
  }

  it("parses both directives out of the headers file", () => {
    expect(imgSrc.length).toBeGreaterThan(1);
    expect(connectSrc.length).toBeGreaterThan(1);
  });

  // CARTO is in the list only when a key is configured, but the CSP has to
  // allow it either way or setting the key would silently blank the map.
  it.each([
    ["carto", CARTO_BASEMAP],
    ["esri", ESRI_BASEMAP],
    ["osm", OSM_BASEMAP],
  ])("allows %s tiles", (_id, basemap) => {
    for (const dark of [true, false]) {
      for (const url of [basemap.base(dark), basemap.labels?.(dark)]) {
        if (!url) continue;
        expect(allowed(url, imgSrc), `${url} missing from img-src`).toBe(true);
        expect(allowed(url, connectSrc), `${url} missing from connect-src`).toBe(true);
      }
    }
  });
});

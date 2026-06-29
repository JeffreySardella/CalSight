import { describe, it, expect } from "vitest";

import indexHtml from "../../index.html?raw";

import headers from "../../public/_headers?raw";

/** Browser CSP hashing is over the script's exact text content, served with LF
 *  line endings. Normalize CRLF so the check is stable on Windows checkouts.
 *  Uses Web Crypto (DOM-typed) so no Node type deps are needed in the frontend
 *  TS project. */
async function sriHash(scriptBody: string): Promise<string> {
  const lf = scriptBody.replace(/\r\n/g, "\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(lf));
  return "sha256-" + btoa(String.fromCharCode(...new Uint8Array(digest)));
}

describe("CSP & font loading safety", () => {
  it("index.html has no inline event handlers (onload, onerror, onclick)", () => {
    const inlineHandlerPattern = /\s(onload|onerror|onclick|onmouseover|onfocus)\s*=/gi;
    const matches = (indexHtml as string).match(inlineHandlerPattern);
    expect(matches).toBeNull();
  });

  it("Google Fonts is loaded as a stylesheet, not a preload with onload swap", () => {
    expect(indexHtml).toContain('rel="stylesheet"');
    expect(indexHtml).toContain("fonts.googleapis.com");
    expect(indexHtml).not.toMatch(/rel="preload"[^>]*fonts\.googleapis\.com/);
  });

  it("Material Symbols font is included in the Google Fonts URL", () => {
    expect(indexHtml).toContain("Material+Symbols+Outlined");
  });

  it("CSP script-src hash matches the actual theme detection script", async () => {
    // The plain inline <script> (no attributes) is the pre-React theme bootstrap.
    const body = (indexHtml as string).match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(body, "theme bootstrap <script> not found in index.html").toBeTruthy();
    const hash = await sriHash(body as string);
    // If this fails after editing the bootstrap, update the hash in public/_headers.
    expect(hash).toBe("sha256-XaTKuElas5PL1kdyE+VJ5ev4+XcFIJkvpWZGejgFhWY=");
    expect(headers).toContain(hash);
  });

  it("CSP script-src hash matches the actual speculation rules script", async () => {
    const body = (indexHtml as string).match(/<script type="speculationrules">([\s\S]*?)<\/script>/)?.[1];
    expect(body, "speculationrules <script> not found in index.html").toBeTruthy();
    expect(headers).toContain(await sriHash(body as string));
  });

  it("CSP allows Google Fonts in style-src and font-src", () => {
    expect(headers).toContain("fonts.googleapis.com");
    expect(headers).toContain("fonts.gstatic.com");
  });

  it("CSP font-src allows data: URIs (html-to-image embeds fonts for Story Canvas export)", () => {
    // Without `data:` in font-src, the Story export renders in fallback fonts
    // because html-to-image inlines fonts as data:font/woff2 URIs.
    const fontSrc = /font-src ([^;]+);/.exec(headers)?.[1] ?? "";
    expect(fontSrc).toContain("data:");
  });
});

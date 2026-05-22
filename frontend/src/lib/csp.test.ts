import { describe, it, expect } from "vitest";

import indexHtml from "../../index.html?raw";

import headers from "../../public/_headers?raw";

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

  it("CSP script-src includes the theme detection script hash", () => {
    expect(headers).toContain("sha256-7KgsK+rf4Rc3ME3W5uAANl/sWTCxGPnFQbCSSiwfV5c=");
  });

  it("CSP script-src includes the speculation rules hash", () => {
    expect(headers).toContain("sha256-UB3x5ELInkHeh1Jo9394EOWX/u0+IzR803lEJbzVhlc=");
  });

  it("CSP allows Google Fonts in style-src and font-src", () => {
    expect(headers).toContain("fonts.googleapis.com");
    expect(headers).toContain("fonts.gstatic.com");
  });
});

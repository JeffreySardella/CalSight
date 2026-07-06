import { describe, it, expect } from "vitest";
import { escapeHtmlAttr, buildContext, rewriteHtml, onRequest } from "./_middleware";

const SAMPLE_HTML = `<!doctype html>
<html>
  <head>
    <title>CalSight</title>
    <meta name="description" content="placeholder" />
    <meta property="og:title" content="placeholder" />
    <meta property="og:description" content="placeholder" />
    <meta property="og:image" content="placeholder" />
    <meta property="og:type" content="placeholder" />
    <meta name="twitter:card" content="placeholder" />
    <meta name="twitter:title" content="placeholder" />
    <meta name="twitter:description" content="placeholder" />
    <meta name="twitter:image" content="placeholder" />
  </head>
  <body></body>
</html>`;

describe("escapeHtmlAttr", () => {
  it("escapes all HTML-attribute-significant characters", () => {
    expect(escapeHtmlAttr(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("escapes the ampersand first so entities are not double-mangled", () => {
    expect(escapeHtmlAttr("&lt;")).toBe("&amp;lt;");
  });

  it("leaves benign text untouched", () => {
    expect(escapeHtmlAttr("Los Angeles, Kern")).toBe("Los Angeles, Kern");
  });
});

describe("rewriteHtml injection hardening", () => {
  it("does not let a counties query param break out of the meta attribute", () => {
    const payload = `"><script>alert(1)</script>`;
    const url = new URL(`https://calsight.org/stats?counties=${encodeURIComponent(payload)}`);
    const ctx = buildContext(url);
    const out = rewriteHtml(SAMPLE_HTML, ctx);

    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&quot;&gt;");
  });

  it("does not let an unescaped quote terminate the description attribute", () => {
    const url = new URL(
      `https://calsight.org/stats?counties=${encodeURIComponent(`x" onmouseover="alert(1)`)}`,
    );
    const out = rewriteHtml(SAMPLE_HTML, buildContext(url));
    expect(out).not.toContain(`" onmouseover="`);
    expect(out).toContain("&quot; onmouseover=&quot;");
  });

  it("inserts $-sequences literally instead of as replacement patterns", () => {
    const url = new URL(`https://calsight.org/stats?counties=${encodeURIComponent("$&$'kern$`")}`);
    const out = rewriteHtml(SAMPLE_HTML, buildContext(url));
    // "$&" would re-insert the matched tag and "$'" the trailing string if a
    // string replacement pattern were used; with a replacer function they
    // survive verbatim (HTML-escaped).
    expect(out).toContain("$&amp;$&#39;kern$`");
    // The original placeholder must have been replaced exactly once, not
    // duplicated by pattern expansion.
    expect(out.match(/<meta name="description"/g)).toHaveLength(1);
  });

  it("URL-encodes user values placed into the og:image query string", () => {
    const url = new URL(
      `https://calsight.org/stats?counties=${encodeURIComponent(`kern&evil="><img>`)}`,
    );
    const ctx = buildContext(url);
    // URLSearchParams percent-encodes the raw value in the OG worker URL...
    expect(ctx.ogImage).toContain("counties=kern%26evil%3D%22%3E%3Cimg%3E");
    // ...so the interpolated attribute contains no raw markup.
    const out = rewriteHtml(SAMPLE_HTML, ctx);
    expect(out).not.toContain("<img>");
  });

  it("escapes the canonical URL derived from the request path", () => {
    const url = new URL(`https://calsight.org/stats%22%3E%3Cscript%3E`);
    const out = rewriteHtml(SAMPLE_HTML, buildContext(url));
    expect(out).not.toContain("<script>");
  });

  it("still produces the expected tags for a normal request", () => {
    const url = new URL("https://calsight.org/stats?preset=dui&counties=kern,los-angeles");
    const out = rewriteHtml(SAMPLE_HTML, buildContext(url));
    expect(out).toContain("<title>DUI Deep Dive Dashboard — CalSight</title>");
    expect(out).toContain(`<meta name="description" content="California crash statistics for kern, los angeles.`);
    expect(out).toContain(`<meta property="og:type" content="article"`);
    expect(out).toContain(`<link rel="canonical" href="https://calsight.org/stats" />`);
  });
});

describe("onRequest content-encoding handling", () => {
  const crawlerReq = () =>
    new Request("https://calsight.org/stats", {
      headers: { "user-agent": "facebookexternalhit/1.1" },
    });

  it("drops content-encoding after decoding the body (fixes broken OG previews)", async () => {
    // The upstream shell can be gzip/br; response.text() decodes it, so copying
    // the original content-encoding onto the plain-text rewrite makes crawlers
    // fail to parse.
    const context = {
      request: crawlerReq(),
      next: async () =>
        new Response("<!doctype html><head></head><body></body>", {
          headers: { "content-type": "text/html", "content-encoding": "gzip" },
        }),
    };
    const out = await onRequest(context as never);
    expect(out.headers.get("content-encoding")).toBeNull();
    const body = await out.text();
    expect(out.headers.get("content-length")).toBe(
      String(new TextEncoder().encode(body).length),
    );
  });

  it("passes non-HTML responses through untouched", async () => {
    const original = new Response("{}", {
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
    });
    const context = { request: crawlerReq(), next: async () => original };
    const out = await onRequest(context as never);
    expect(out).toBe(original);
  });
});

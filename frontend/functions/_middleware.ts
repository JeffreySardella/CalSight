/**
 * Cloudflare Pages Middleware: Social Crawler Meta Tag Injection
 *
 * Problem: CalSight is a React SPA — social media crawlers (Twitter, Facebook,
 * LinkedIn, Slack) don't execute JavaScript, so they see the static index.html
 * meta tags regardless of which page or dashboard configuration is being shared.
 *
 * Solution: This middleware intercepts requests from known social crawlers,
 * fetches the SPA shell, and rewrites the <head> section with page-specific
 * Open Graph tags. Non-crawler requests pass through to the normal SPA.
 *
 * How it works:
 * 1. Check User-Agent for known social crawlers
 * 2. If not a crawler, pass through unchanged
 * 3. If crawler, parse the URL to determine page context
 * 4. Rewrite meta tags in the HTML response based on the route
 * 5. Point og:image at the OG image Worker for dynamic previews
 *
 * Deploy: Place this file at frontend/functions/_middleware.ts
 * Cloudflare Pages automatically picks up files in /functions.
 */

interface CrawlerContext {
  title: string;
  description: string;
  ogImage: string;
  ogType: string;
  canonicalUrl: string;
}

const SITE_URL = "https://calsight.org";
const OG_WORKER_URL = "https://og.calsight.org";

const CRAWLER_USER_AGENTS = [
  "Twitterbot",
  "facebookexternalhit",
  "LinkedInBot",
  "Slackbot",
  "Discordbot",
  "WhatsApp",
  "TelegramBot",
  "redditbot",
  "Googlebot",
  "bingbot",
  "Baiduspider",
  "DuckDuckBot",
  "Applebot",
];

function isCrawler(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  return CRAWLER_USER_AGENTS.some((bot) => ua.includes(bot.toLowerCase()));
}

/**
 * Escape a value for interpolation into an HTML attribute (or text node).
 * User-controlled query params (counties, preset, …) flow into the rewritten
 * meta tags, so every interpolated value must be escaped to prevent HTML
 * injection. Exported for tests.
 */
export function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildContext(url: URL): CrawlerContext {
  const pathname = url.pathname;
  const params = url.searchParams;

  const base: CrawlerContext = {
    title: "CalSight — California Crash Data Explorer",
    description: "Explore 11 million California traffic crashes with interactive maps, AI-powered insights, and demographic analysis.",
    ogImage: `${OG_WORKER_URL}/og?title=California+Crash+Data+Explorer`,
    ogType: "website",
    canonicalUrl: `${SITE_URL}${pathname}`,
  };

  if (pathname === "/stats") {
    const preset = params.get("preset") || "";
    const dashboard = params.get("dashboard") || "";
    const counties = params.get("counties") || "";

    const presetLabels: Record<string, string> = {
      overview: "Safety Overview",
      time: "Time Patterns",
      demographics: "Demographics",
      rates: "Fatality Focus",
      dui: "DUI Deep Dive",
      seasonal: "Injury Analysis",
      equity: "Equity & Safety",
      comparison: "County Comparison",
    };

    const presetTitle = preset && presetLabels[preset]
      ? `${presetLabels[preset]} Dashboard`
      : "Statistics Dashboard";

    base.title = `${presetTitle} — CalSight`;
    base.description = counties
      ? `California crash statistics for ${counties.replace(/,/g, ", ").replace(/-/g, " ")}. Explore trends, demographics, and safety metrics.`
      : "Interactive California crash statistics dashboard with customizable charts, trends, and AI-powered insights.";

    const ogParams = new URLSearchParams();
    if (preset) ogParams.set("preset", preset);
    if (counties) ogParams.set("counties", counties);
    if (dashboard) ogParams.set("dashboard", "1"); // signal that it's a custom dashboard
    base.ogImage = `${OG_WORKER_URL}/og/stats?${ogParams.toString()}`;
    base.ogType = "article";
  } else if (pathname === "/ask") {
    base.title = "Ask AI — CalSight";
    base.description = "Ask questions about California traffic crash data using AI. Get instant insights about trends, causes, and safety statistics.";
    base.ogImage = `${OG_WORKER_URL}/og?title=Ask+AI+About+Crash+Data&subtitle=Natural+language+queries+for+11M%2B+records`;
  } else if (pathname === "/about") {
    base.title = "About CalSight — Data Sources & Methodology";
    base.description = "Learn about CalSight's data sources (SWITRS, CCRS, Census ACS, CalEnviroScreen), methodology, and the team behind the platform.";
    base.ogImage = `${OG_WORKER_URL}/og?title=About+CalSight&subtitle=Data+Sources+%26+Methodology`;
  } else if (pathname === "/") {
    base.title = "CalSight — California Crash Data Explorer";
    base.description = "Interactive map of 11 million California traffic crashes. Filter by county, severity, cause, and year. AI-powered safety insights.";
    base.ogImage = `${OG_WORKER_URL}/og?title=California+Crash+Data+Explorer&subtitle=11M%2B+crashes+%E2%80%A2+58+counties+%E2%80%A2+2001%E2%80%93present`;
  }

  return base;
}

export function rewriteHtml(html: string, ctx: CrawlerContext): string {
  // Escape every interpolated value once, up front. All replacements below
  // use a function replacer so `$` sequences in user-influenced values are
  // inserted literally instead of being interpreted as replacement patterns.
  const title = escapeHtmlAttr(ctx.title);
  const description = escapeHtmlAttr(ctx.description);
  const ogImage = escapeHtmlAttr(ctx.ogImage);
  const ogType = escapeHtmlAttr(ctx.ogType);
  const canonicalUrl = escapeHtmlAttr(ctx.canonicalUrl);

  // Replace existing meta tags with dynamic values
  let result = html;

  // Title
  result = result.replace(
    /<title>[^<]*<\/title>/,
    () => `<title>${title}</title>`
  );

  // Description
  result = result.replace(
    /<meta name="description" content="[^"]*"/,
    () => `<meta name="description" content="${description}"`
  );

  // OG tags
  result = result.replace(
    /<meta property="og:title" content="[^"]*"/,
    () => `<meta property="og:title" content="${title}"`
  );
  result = result.replace(
    /<meta property="og:description" content="[^"]*"/,
    () => `<meta property="og:description" content="${description}"`
  );
  result = result.replace(
    /<meta property="og:image" content="[^"]*"/,
    () => `<meta property="og:image" content="${ogImage}"`
  );
  result = result.replace(
    /<meta property="og:type" content="[^"]*"/,
    () => `<meta property="og:type" content="${ogType}"`
  );

  // Twitter tags
  result = result.replace(
    /<meta name="twitter:card" content="[^"]*"/,
    () => `<meta name="twitter:card" content="summary_large_image"`
  );
  result = result.replace(
    /<meta name="twitter:title" content="[^"]*"/,
    () => `<meta name="twitter:title" content="${title}"`
  );
  result = result.replace(
    /<meta name="twitter:description" content="[^"]*"/,
    () => `<meta name="twitter:description" content="${description}"`
  );
  result = result.replace(
    /<meta name="twitter:image" content="[^"]*"/,
    () => `<meta name="twitter:image" content="${ogImage}"`
  );

  // Inject canonical URL and additional OG tags after <title>
  const additionalTags = `
    <meta property="og:url" content="${canonicalUrl}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:site_name" content="CalSight" />
    <meta name="twitter:image:alt" content="${title} — dashboard preview" />
    <link rel="canonical" href="${canonicalUrl}" />`;

  result = result.replace("</title>", () => `</title>${additionalTags}`);

  return result;
}

// Cloudflare Pages Functions middleware export
export const onRequest: PagesFunction = async (context) => {
  const { request, next } = context;
  const userAgent = request.headers.get("user-agent") || "";

  // Non-crawlers get the normal SPA response
  if (!isCrawler(userAgent)) {
    return next();
  }

  // For crawlers, fetch the response and rewrite meta tags
  const response = await next();
  const contentType = response.headers.get("content-type") || "";

  // Only rewrite HTML responses (not JS, CSS, images, etc.)
  if (!contentType.includes("text/html")) {
    return response;
  }

  const url = new URL(request.url);
  const ctx = buildContext(url);
  const html = await response.text();
  const rewritten = rewriteHtml(html, ctx);

  // response.text() decoded any gzip/br, so the rewritten body is plain text.
  // Drop the upstream content-encoding (and recompute content-length) or
  // crawlers try to decompress plain text and OG previews break.
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.set("content-length", new TextEncoder().encode(rewritten).length.toString());

  return new Response(rewritten, {
    status: response.status,
    headers,
  });
};

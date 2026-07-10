/**
 * Cloudflare Worker: Dynamic OG Image Generator for CalSight
 *
 * Generates 1200x630 PNG Open Graph images for shared dashboard links.
 * Uses SVG-to-PNG rendering via resvg-wasm (loaded lazily).
 *
 * Routes:
 *   GET /og?title=...&subtitle=...&metric=...&trend=up|down
 *   GET /og/stats?preset=overview&counties=los-angeles,san-diego
 *   GET /og/dashboard?dashboard=<encoded-config>
 *
 * The generated image includes:
 *   - CalSight branding (logo, gradient background)
 *   - Dynamic title/subtitle from query params
 *   - Mini chart sparkline (if metric data available)
 *   - Filter context (counties, date range)
 *
 * Caching: Worker-generated responses are NOT cached by `s-maxage` alone, so
 * we read/write the edge Cache API explicitly, keyed on a normalized URL that
 * contains only the (clamped, sorted) params the renderer actually uses.
 * Browsers may cache for 1 hour via Cache-Control.
 */

import { Resvg, initWasm } from "@resvg/resvg-wasm";
// @ts-expect-error — Cloudflare Workers import WASM as a module
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";

// Shared init promise so two concurrent cold-start requests don't both call
// initWasm — the second call throws "already initialized" (audit M14). Reset
// to null on failure so a transient init error can be retried by a later
// request instead of poisoning the isolate forever.
let initPromise: Promise<void> | null = null;

function ensureWasm(): Promise<void> {
  initPromise ??= Promise.resolve(initWasm(resvgWasm)).catch((err) => {
    initPromise = null;
    throw err;
  });
  return initPromise;
}

export interface Env {
  SITE_URL: string;
  API_BASE: string;
  // OG_CACHE: KVNamespace; // uncomment when KV is configured
}

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

// Brand colors
const BRAND = {
  primary: "#6B21A8",       // purple-800
  primaryLight: "#A855F7",  // purple-500
  surface: "#1C1B1F",       // dark surface
  surfaceLight: "#2D2B33",  // elevated surface
  textPrimary: "#FFFFFF",
  textSecondary: "#C4C0CC",
  accent: "#22D3EE",        // cyan-400 for metrics
  error: "#F87171",         // red-400 for trending up (bad)
  success: "#4ADE80",       // green-400 for trending down (good)
};

interface OgParams {
  title: string;
  subtitle: string;
  metric?: string;
  metricLabel?: string;
  trend?: "up" | "down" | "neutral";
  counties?: string[];
  preset?: string;
}

// Upper bounds on query-param lengths, applied at parse time. The SVG layout
// truncates for display anyway (title at 30 chars etc.), but unbounded input
// would still flow into escapeXml/render work — clamp before anything uses it.
const MAX_TITLE_LEN = 80;
const MAX_SUBTITLE_LEN = 120;
const MAX_METRIC_LEN = 24;
const MAX_METRIC_LABEL_LEN = 40;
const MAX_COUNTY_LEN = 30;
const MAX_COUNTIES = 58; // California has 58 counties; anything beyond is junk

function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function clampedParam(params: URLSearchParams, name: string, max: number): string | undefined {
  const raw = params.get(name);
  return raw ? clamp(raw, max) : undefined;
}

/** Whitelist trend to the three values the renderer understands. */
function parseTrend(params: URLSearchParams): "up" | "down" | "neutral" | undefined {
  const raw = params.get("trend");
  return raw === "up" || raw === "down" || raw === "neutral" ? raw : undefined;
}

function parseRequest(url: URL): OgParams {
  const params = url.searchParams;
  const pathname = url.pathname;

  if (pathname === "/og/stats" || pathname === "/og/dashboard") {
    const preset = clamp(params.get("preset") || "overview", 32);
    const countiesRaw = params.get("counties") || "";
    const counties = countiesRaw
      ? countiesRaw
          .split(",")
          .slice(0, MAX_COUNTIES)
          .map(c => clamp(c, MAX_COUNTY_LEN).replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase()))
      : [];

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

    return {
      title: presetLabels[preset] || "Statistics Dashboard",
      subtitle: counties.length > 0
        ? counties.slice(0, 3).join(", ") + (counties.length > 3 ? ` +${counties.length - 3} more` : "")
        : "All California Counties",
      metric: clampedParam(params, "metric", MAX_METRIC_LEN),
      metricLabel: clampedParam(params, "metricLabel", MAX_METRIC_LABEL_LEN),
      trend: parseTrend(params),
      counties,
      preset,
    };
  }

  return {
    title: clampedParam(params, "title", MAX_TITLE_LEN) || "California Crash Data Explorer",
    subtitle: clampedParam(params, "subtitle", MAX_SUBTITLE_LEN) || "Interactive maps, AI insights, and demographic analysis",
    metric: clampedParam(params, "metric", MAX_METRIC_LEN),
    metricLabel: clampedParam(params, "metricLabel", MAX_METRIC_LABEL_LEN),
    trend: parseTrend(params),
  };
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function generateSparkline(trend: "up" | "down" | "neutral"): string {
  // Simple decorative sparkline paths for the OG image
  const points = trend === "up"
    ? "M0,40 L20,38 L40,35 L60,30 L80,25 L100,28 L120,20 L140,15 L160,10 L180,5"
    : trend === "down"
    ? "M0,5 L20,8 L40,12 L60,18 L80,22 L100,20 L120,28 L140,33 L160,38 L180,40"
    : "M0,20 L20,22 L40,18 L60,20 L80,19 L100,21 L120,20 L140,18 L160,22 L180,20";

  const color = trend === "up" ? BRAND.error : trend === "down" ? BRAND.success : BRAND.accent;

  return `
    <g transform="translate(820, 380)">
      <path d="${points}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>
      <path d="${points} L180,50 L0,50 Z" fill="${color}" opacity="0.1"/>
    </g>
  `;
}

function generateSvg(params: OgParams): string {
  const { title, subtitle, metric, metricLabel, trend } = params;

  const sparkline = trend ? generateSparkline(trend) : "";
  const metricSection = metric ? `
    <g transform="translate(80, 370)">
      <text font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="600" fill="${BRAND.textSecondary}" letter-spacing="2" text-transform="uppercase">
        ${escapeXml(metricLabel || "KEY METRIC")}
      </text>
      <text y="50" font-family="system-ui, -apple-system, sans-serif" font-size="52" font-weight="700" fill="${BRAND.accent}">
        ${escapeXml(metric)}
      </text>
      ${trend ? `
        <g transform="translate(${metric.length * 30 + 20}, 22)">
          <text font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="600" fill="${trend === "up" ? BRAND.error : BRAND.success}">
            ${trend === "up" ? "↑" : "↓"}
          </text>
        </g>
      ` : ""}
    </g>
  ` : "";

  // County badges
  const countyBadges = params.counties && params.counties.length > 0 ? `
    <g transform="translate(80, ${metric ? 470 : 380})">
      ${params.counties.slice(0, 4).map((county, i) => `
        <g transform="translate(${i * 160}, 0)">
          <rect width="150" height="32" rx="16" fill="${BRAND.surfaceLight}" stroke="${BRAND.primaryLight}" stroke-width="1" opacity="0.6"/>
          <text x="75" y="21" font-family="system-ui, -apple-system, sans-serif" font-size="12" font-weight="500" fill="${BRAND.textSecondary}" text-anchor="middle">
            ${escapeXml(county.length > 14 ? county.slice(0, 12) + "..." : county)}
          </text>
        </g>
      `).join("")}
    </g>
  ` : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${BRAND.surface}"/>
      <stop offset="100%" stop-color="#0F0A1E"/>
    </linearGradient>
    <linearGradient id="accent-line" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${BRAND.primary}"/>
      <stop offset="100%" stop-color="${BRAND.accent}"/>
    </linearGradient>
    <!-- Subtle grid pattern -->
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${BRAND.surfaceLight}" stroke-width="0.5" opacity="0.3"/>
    </pattern>
  </defs>

  <!-- Background -->
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#bg)"/>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#grid)" opacity="0.4"/>

  <!-- Accent gradient bar at top -->
  <rect y="0" width="${OG_WIDTH}" height="4" fill="url(#accent-line)"/>

  <!-- Decorative circles -->
  <circle cx="1050" cy="150" r="200" fill="${BRAND.primary}" opacity="0.08"/>
  <circle cx="1100" cy="500" r="120" fill="${BRAND.accent}" opacity="0.05"/>

  <!-- Logo area -->
  <g transform="translate(80, 50)">
    <!-- CalSight text logo -->
    <text font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="700" fill="${BRAND.textPrimary}" letter-spacing="-0.5">
      CalSight
    </text>
    <text x="135" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="400" fill="${BRAND.textSecondary}" letter-spacing="1">
      California Crash Data Explorer
    </text>
  </g>

  <!-- Main title -->
  <g transform="translate(80, 150)">
    <text font-family="system-ui, -apple-system, sans-serif" font-size="56" font-weight="800" fill="${BRAND.textPrimary}" letter-spacing="-1">
      ${escapeXml(title.length > 30 ? title.slice(0, 28) + "..." : title)}
    </text>
  </g>

  <!-- Subtitle -->
  <g transform="translate(80, 220)">
    <text font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="400" fill="${BRAND.textSecondary}" letter-spacing="0.2">
      ${escapeXml(subtitle.length > 60 ? subtitle.slice(0, 58) + "..." : subtitle)}
    </text>
  </g>

  <!-- Separator -->
  <rect x="80" y="270" width="200" height="3" rx="1.5" fill="url(#accent-line)"/>

  <!-- Metric section (if provided) -->
  ${metricSection}

  <!-- Sparkline (if trend provided) -->
  ${sparkline}

  <!-- County badges -->
  ${countyBadges}

  <!-- Footer -->
  <g transform="translate(80, 570)">
    <text font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="500" fill="${BRAND.textSecondary}" opacity="0.7">
      calsight.org • 11M+ crash records • 58 counties • 2001–present
    </text>
  </g>

  <!-- CTA arrow -->
  <g transform="translate(1080, 550)">
    <rect width="80" height="40" rx="20" fill="${BRAND.primaryLight}" opacity="0.9"/>
    <text x="40" y="27" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="600" fill="${BRAND.textPrimary}" text-anchor="middle">
      →
    </text>
  </g>
</svg>`;
}

/**
 * Normalized cache key: origin + pathname + only the (already clamped) params
 * the renderer actually uses, sorted, so param order / junk params / oversized
 * values don't fragment the edge cache or bypass it.
 */
function buildCacheKey(url: URL, params: OgParams): Request {
  const key = new URL(url.origin + url.pathname);
  const entries: Array<[string, string]> = [
    ["title", params.title],
    ["subtitle", params.subtitle],
  ];
  if (params.metric) entries.push(["metric", params.metric]);
  if (params.metricLabel) entries.push(["metricLabel", params.metricLabel]);
  if (params.trend) entries.push(["trend", params.trend]);
  if (params.counties?.length) entries.push(["counties", params.counties.join(",")]);
  if (params.preset) entries.push(["preset", params.preset]);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [name, value] of entries) key.searchParams.set(name, value);
  return new Request(key.toString(), { method: "GET" });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Only handle /og routes
    if (!url.pathname.startsWith("/og")) {
      return new Response("Not found", { status: 404 });
    }

    // CORS headers for cross-origin embedding
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    const params = parseRequest(url);

    // Edge cache: `s-maxage` alone does not cache Worker-generated responses,
    // so consult/populate the Cache API explicitly (audit M14). A link fanning
    // out to N crawlers renders once instead of N times.
    const cacheKey = buildCacheKey(url, params);
    const cached = await caches.default.match(cacheKey);
    if (cached) return cached;

    await ensureWasm();

    const svg = generateSvg(params);

    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: OG_WIDTH },
    });
    const png = resvg.render().asPng();

    const headers = new Headers({
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      ...corsHeaders,
    });

    const response = new Response(png, { status: 200, headers });
    ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    return response;
  },
};

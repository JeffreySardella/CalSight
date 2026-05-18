/**
 * Dynamic meta tag manager for SEO and social sharing.
 *
 * React doesn't natively manage <head> tags, so this component directly
 * manipulates the DOM meta tags on mount/update. This is the same approach
 * used by react-helmet-async but without the extra dependency — we only
 * need a handful of tags and don't need SSR support (Cloudflare Pages
 * serves the static shell, and social crawlers hit the Worker).
 *
 * Usage:
 *   <MetaTags
 *     title="Safety Overview — CalSight"
 *     description="Explore California crash trends..."
 *     ogImage="https://og.calsight.org/og/stats?preset=overview"
 *     path="/stats"
 *   />
 */

import { useEffect } from "react";

const SITE_URL = "https://calsight.org";
const OG_WORKER_URL = "https://og.calsight.org";
const DEFAULT_TITLE = "CalSight — California Crash Data Explorer";
const DEFAULT_DESCRIPTION =
  "Explore 11 million California traffic crashes with interactive maps, AI-powered insights, and demographic analysis. Filter by county, cause, severity, and year.";
const DEFAULT_OG_IMAGE = `${SITE_URL}/web-app-manifest-512x512.png`;

export interface MetaTagsProps {
  title?: string;
  description?: string;
  ogImage?: string;
  ogType?: string;
  path?: string;
  /** Additional structured data (JSON-LD) to inject */
  jsonLd?: Record<string, unknown>;
  /** Twitter card type — "summary_large_image" shows the big preview */
  twitterCard?: "summary" | "summary_large_image";
}

function setMeta(property: string, content: string, isName = false) {
  const attr = isName ? "name" : "property";
  let el = document.querySelector(`meta[${attr}="${property}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, property);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setOrRemoveJsonLd(id: string, data: Record<string, unknown> | undefined) {
  const existing = document.getElementById(id);
  if (!data) {
    existing?.remove();
    return;
  }
  if (existing) {
    existing.textContent = JSON.stringify(data);
  } else {
    const script = document.createElement("script");
    script.id = id;
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(data);
    document.head.appendChild(script);
  }
}

export default function MetaTags({
  title,
  description,
  ogImage,
  ogType = "website",
  path = "/",
  jsonLd,
  twitterCard = "summary_large_image",
}: MetaTagsProps) {
  useEffect(() => {
    const fullTitle = title || DEFAULT_TITLE;
    const fullDesc = description || DEFAULT_DESCRIPTION;
    const fullImage = ogImage || DEFAULT_OG_IMAGE;
    const canonicalUrl = `${SITE_URL}${path}`;

    // Page title is set by Layout.tsx, but we can override it for specificity
    document.title = fullTitle;

    // Standard meta
    setMeta("description", fullDesc, true);

    // Open Graph
    setMeta("og:title", fullTitle);
    setMeta("og:description", fullDesc);
    setMeta("og:image", fullImage);
    setMeta("og:image:width", "1200");
    setMeta("og:image:height", "630");
    setMeta("og:type", ogType);
    setMeta("og:url", canonicalUrl);
    setMeta("og:site_name", "CalSight");

    // Twitter/X Cards
    setMeta("twitter:card", twitterCard, true);
    setMeta("twitter:title", fullTitle, true);
    setMeta("twitter:description", fullDesc, true);
    setMeta("twitter:image", fullImage, true);
    setMeta("twitter:image:alt", `${fullTitle} — CalSight dashboard preview`, true);

    // Canonical URL
    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalUrl;

    // JSON-LD structured data
    setOrRemoveJsonLd("calsight-jsonld", jsonLd);

    return () => {
      // Cleanup: reset to defaults when component unmounts
      document.title = DEFAULT_TITLE;
      setMeta("og:title", DEFAULT_TITLE);
      setMeta("og:description", DEFAULT_DESCRIPTION);
      setMeta("og:image", DEFAULT_OG_IMAGE);
      setMeta("twitter:title", DEFAULT_TITLE, true);
      setMeta("twitter:description", DEFAULT_DESCRIPTION, true);
      setMeta("twitter:image", DEFAULT_OG_IMAGE, true);
      setOrRemoveJsonLd("calsight-jsonld", undefined);
    };
  }, [title, description, ogImage, ogType, path, jsonLd, twitterCard]);

  return null;
}

/**
 * Builds an OG image URL for the Worker, encoding dashboard state as query params.
 */
export function buildOgImageUrl(params: {
  preset?: string;
  counties?: string[];
  metric?: string;
  metricLabel?: string;
  trend?: "up" | "down" | "neutral";
  title?: string;
  subtitle?: string;
}): string {
  const url = new URL(`${OG_WORKER_URL}/og/stats`);
  if (params.preset) url.searchParams.set("preset", params.preset);
  if (params.counties?.length) url.searchParams.set("counties", params.counties.join(","));
  if (params.metric) url.searchParams.set("metric", params.metric);
  if (params.metricLabel) url.searchParams.set("metricLabel", params.metricLabel);
  if (params.trend) url.searchParams.set("trend", params.trend);
  if (params.title) url.searchParams.set("title", params.title);
  if (params.subtitle) url.searchParams.set("subtitle", params.subtitle);
  return url.toString();
}

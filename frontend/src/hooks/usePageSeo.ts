/**
 * Hook for setting page-level SEO metadata.
 *
 * This is a thin convenience wrapper around the MetaTags component's logic
 * for cases where you want to set SEO state imperatively (e.g., based on
 * async data that arrives after mount).
 *
 * For most pages, prefer using the <MetaTags> component directly in JSX.
 */

import { useEffect } from "react";

const SITE_URL = "https://calsight.org";

interface PageSeoOptions {
  title: string;
  description: string;
  canonicalPath?: string;
}

export function usePageSeo({ title, description, canonicalPath }: PageSeoOptions) {
  useEffect(() => {
    document.title = title;

    // Update meta description
    const descEl = document.querySelector('meta[name="description"]');
    if (descEl) descEl.setAttribute("content", description);

    // Update canonical
    if (canonicalPath) {
      let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
      if (!canonical) {
        canonical = document.createElement("link");
        canonical.rel = "canonical";
        document.head.appendChild(canonical);
      }
      canonical.href = `${SITE_URL}${canonicalPath}`;
    }
  }, [title, description, canonicalPath]);
}

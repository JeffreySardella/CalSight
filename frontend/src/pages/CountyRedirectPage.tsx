/**
 * CountyRedirectPage — /county/:slug
 *
 * Bare `/county/<slug>` isn't a page of its own; only `/county/:slug/report`
 * is. Without this route the SPA fell through to `*` and rendered a soft
 * 404 (HTTP 200, "Page Not Found") for a perfectly good county slug. A
 * valid slug redirects straight to its report card; an invalid one still
 * gets the normal not-found page.
 */
import { Navigate, useParams } from "react-router-dom";
import { CA_COUNTIES, slugify } from "../hooks/useFilterParams";
import NotFoundPage from "./NotFoundPage";

const VALID_SLUGS = new Set(CA_COUNTIES.map((c) => slugify(c)));

export default function CountyRedirectPage() {
  const { slug } = useParams<{ slug: string }>();
  const normalized = slug?.toLowerCase();
  if (normalized && VALID_SLUGS.has(normalized)) {
    return <Navigate to={`/county/${normalized}/report`} replace />;
  }
  return <NotFoundPage />;
}

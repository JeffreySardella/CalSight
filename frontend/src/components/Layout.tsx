import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { scrollBehavior } from "../lib/a11y/motion";
import NavBar from "./NavBar";
import Footer from "./Footer";
import BottomTabBar from "./BottomTabBar";
import { OfflineIndicator } from "./ui/OfflineIndicator";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { pageTitleFor } from "../lib/pageTitles";

export default function Layout() {
  const location = useLocation();
  const isMapPage = location.pathname === "/";
  const isAskPage = location.pathname === "/ask";

  useEffect(() => {
    const title = pageTitleFor(location.pathname, location.search);
    if (title !== null) document.title = title;
  }, [location.pathname, location.search]);

  // Scroll to hash anchor when navigating — keyed on pathname+hash, ignoring search params
  const scrollKey = location.pathname + location.hash;
  useEffect(() => {
    if (location.hash) {
      const el = document.getElementById(location.hash.slice(1));
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: scrollBehavior() }), 100);
      }
    }
  }, [scrollKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset scroll on an actual page change. Keyed on pathname alone (not the
  // full location) so the map's constant query-string writes never trigger
  // it, and skipped when the URL carries a #hash — the effect above owns
  // scrolling to that anchor instead. This is what stopped e.g. Water from
  // opening mid-scroll after a bottom-nav tap from a long Stats page.
  useEffect(() => {
    if (location.hash) return;
    window.scrollTo(0, 0);
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:bg-primary focus:text-on-primary focus:px-4 focus:py-2 focus:rounded-lg focus:text-sm focus:font-semibold"
      >
        Skip to main content
      </a>
      <ErrorBoundary fallback={<header className="bg-surface fixed top-0 z-50 h-12 md:h-16 w-full" aria-hidden="true" />}>
        <NavBar />
      </ErrorBoundary>
      <OfflineIndicator />
      <ErrorBoundary resetKey={location.pathname}>
      {isMapPage ? (
        <main id="main-content" className="pt-12 pb-14 md:pt-16 lg:pb-0 flex h-dvh overflow-hidden">
          <Outlet />
        </main>
      ) : isAskPage ? (
        <div key={location.pathname} className="page-enter pt-12 pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] md:pt-16 lg:pb-0 h-dvh flex flex-col overflow-hidden">
          <main id="main-content" className="flex-1 flex flex-col overflow-hidden">
            <Outlet />
          </main>
        </div>
      ) : (
        <div key={location.pathname} className="page-enter pt-12 md:pt-16 min-h-screen flex flex-col pb-20 lg:pb-0">
          <main id="main-content" className="flex-1">
            <Outlet />
          </main>
          <Footer />
        </div>
      )}
      </ErrorBoundary>
      <ErrorBoundary fallback={null}>
        <BottomTabBar />
      </ErrorBoundary>
    </>
  );
}

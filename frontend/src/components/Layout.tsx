import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { scrollBehavior } from "../lib/a11y/motion";
import NavBar from "./NavBar";
import Footer from "./Footer";
import BottomTabBar from "./BottomTabBar";
import { OfflineIndicator } from "./ui/OfflineIndicator";
import { ErrorBoundary } from "./ui/ErrorBoundary";

const PAGE_TITLES: Record<string, string> = {
  "/": "Map Explorer — CalSight",
  "/stats": "Statistics Dashboard — CalSight",
  "/ask": "Ask AI — CalSight",
  "/about": "About — CalSight",
  "/privacy": "Privacy Policy — CalSight",
  "/admin/etl": "ETL Admin — CalSight",
};

export default function Layout() {
  const location = useLocation();
  const isMapPage = location.pathname === "/";
  const isAskPage = location.pathname === "/ask";

  useEffect(() => {
    document.title = PAGE_TITLES[location.pathname] || "CalSight — California Crash Data Explorer";
  }, [location.pathname]);

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
        <main id="main-content" className="pt-12 pb-14 md:pt-16 md:pb-0 flex h-dvh overflow-hidden">
          <Outlet />
        </main>
      ) : isAskPage ? (
        <div key={location.pathname} className="page-enter pt-12 pb-14 md:pt-16 md:pb-0 h-dvh flex flex-col overflow-hidden">
          <main id="main-content" className="flex-1 flex flex-col overflow-hidden">
            <Outlet />
          </main>
        </div>
      ) : (
        <div key={location.pathname} className="page-enter pt-12 md:pt-16 min-h-screen flex flex-col pb-20 md:pb-0">
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

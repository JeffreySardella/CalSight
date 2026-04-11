import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import NavBar from "./NavBar";
import Footer from "./Footer";
import BottomTabBar from "./BottomTabBar";

export default function Layout() {
  const location = useLocation();
  const isMapPage = location.pathname === "/";

  // Scroll to hash anchor when navigating (e.g., /about#data-sources)
  useEffect(() => {
    if (location.hash) {
      const el = document.getElementById(location.hash.slice(1));
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: "smooth" }), 100);
      }
    } else {
      window.scrollTo(0, 0);
    }
  }, [location]);

  return (
    <>
      <NavBar />
      {isMapPage ? (
        <main className="pt-12 pb-14 md:pt-16 md:pb-0 flex h-dvh overflow-hidden">
          <Outlet />
        </main>
      ) : (
        <div key={location.pathname} className="page-enter pt-12 md:pt-16 min-h-screen flex flex-col pb-20 md:pb-0">
          <main className="flex-1">
            <Outlet />
          </main>
          <Footer />
        </div>
      )}
      <BottomTabBar />
    </>
  );
}

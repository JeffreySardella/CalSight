import { Outlet, useLocation } from "react-router-dom";
import NavBar from "./NavBar";
import Footer from "./Footer";
import BottomTabBar from "./BottomTabBar";

export default function Layout() {
  const location = useLocation();
  const isMapPage = location.pathname === "/";

  return (
    <>
      <NavBar />
      {isMapPage ? (
        <main className="pt-16 flex h-screen overflow-hidden">
          <Outlet />
        </main>
      ) : (
        <div className="pt-16 min-h-screen flex flex-col pb-20 md:pb-0">
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

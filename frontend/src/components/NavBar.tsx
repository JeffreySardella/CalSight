import { useState, useRef } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import { buildFilterQS } from "../hooks/useFilterParams";
import logo from "../assets/logo.png";
import SettingsPopover from "./SettingsPopover";

const navLinks = [
  { to: "/", label: "Map" },
  { to: "/stats", label: "Stats" },
  { to: "/about", label: "About" },
];

export default function NavBar() {
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [searchParams] = useSearchParams();

  const qs = buildFilterQS(searchParams);


  return (
    <header className="bg-surface fixed top-0 z-50 flex w-full items-center justify-between px-4 py-2 h-12 md:px-6 md:py-3 md:h-16">
      <div className="flex items-center gap-8">
        <NavLink to="/" className="flex items-center gap-2">
          <img src={logo} alt="CalSight" className="h-7 w-auto" />
          <span className="text-xl font-bold tracking-tighter text-on-surface font-headline">
            CalSight
          </span>
          <span className="text-[9px] font-bold uppercase tracking-widest text-primary bg-primary-container px-2 py-0.5 rounded-full">
            Beta
          </span>
        </NavLink>
        <nav className="hidden md:flex gap-6 items-center">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={qs ? `${link.to}?${qs}` : link.to}
              end={link.to === "/"}
              className={({ isActive }) =>
                `font-headline tracking-tight text-sm font-semibold transition-colors ${
                  isActive
                    ? "text-on-surface border-b-2 border-primary pb-1"
                    : "text-on-surface-variant hover:text-on-surface"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Settings gear + popover */}
      <div ref={settingsRef} className="flex items-center relative">
        <button
          onClick={() => setShowSettings((prev) => !prev)}
          className="p-2 hover:bg-surface-container rounded-md transition-all text-primary"
        >
          <span className="material-symbols-outlined">settings</span>
        </button>
        {showSettings && (
          <SettingsPopover onClose={() => setShowSettings(false)} containerRef={settingsRef} />
        )}
      </div>
    </header>
  );
}

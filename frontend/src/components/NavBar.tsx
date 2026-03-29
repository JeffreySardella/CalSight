import { NavLink } from "react-router-dom";
import logo from "../assets/logo.png";

const navLinks = [
  { to: "/", label: "Map" },
  { to: "/stats", label: "Stats" },
  { to: "/ask-ai", label: "Ask AI" },
  { to: "/about", label: "About" },
];

export default function NavBar() {
  return (
    <header className="bg-surface fixed top-0 z-50 flex w-full items-center justify-between px-6 py-3 h-16">
      <div className="flex items-center gap-8">
        <NavLink to="/" className="flex items-center gap-2">
          <img src={logo} alt="CalSight" className="h-7 w-auto" />
          <span className="text-xl font-bold tracking-tighter text-on-surface font-headline">
            CalSight
          </span>
        </NavLink>
        <nav className="hidden md:flex gap-6 items-center">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
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

      {/* Desktop: settings gear only */}
      <div className="hidden md:flex items-center">
        <button className="p-2 hover:bg-surface-container rounded-md transition-all text-primary">
          <span className="material-symbols-outlined">settings</span>
        </button>
      </div>
    </header>
  );
}

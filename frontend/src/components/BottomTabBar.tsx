import { NavLink, useSearchParams } from "react-router-dom";

const tabs = [
  { to: "/", icon: "map", label: "Map" },
  { to: "/stats", icon: "insights", label: "Stats" },
  { to: "/ask-ai", icon: "psychology", label: "Ask AI" },
  { to: "/about", icon: "info", label: "About" },
] as const;

export default function BottomTabBar() {
  const [searchParams] = useSearchParams();

  const filterParams = new URLSearchParams();
  const year = searchParams.get("year");
  const severity = searchParams.get("severity");
  const county = searchParams.get("county");
  const cause = searchParams.get("cause");
  if (year) filterParams.set("year", year);
  if (severity) filterParams.set("severity", severity);
  if (county) filterParams.set("county", county);
  if (cause) filterParams.set("cause", cause);
  const qs = filterParams.toString();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-surface-container-lowest bottom-tab-shadow" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="flex items-center justify-around h-20">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={qs ? `${tab.to}?${qs}` : tab.to}
            end={tab.to === "/"}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 transition-colors ${
                isActive
                  ? "text-primary"
                  : "text-on-surface-variant"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`flex items-center justify-center rounded-xl transition-colors ${
                    isActive
                      ? "bg-primary-container px-4 py-2"
                      : "px-4 py-2"
                  }`}
                >
                  <span
                    className="material-symbols-outlined text-[22px]"
                    style={
                      isActive
                        ? { fontVariationSettings: "'FILL' 1" }
                        : undefined
                    }
                  >
                    {tab.icon}
                  </span>
                </span>
                <span
                  className={`text-[10px] tracking-widest uppercase ${
                    isActive ? "font-bold" : "font-medium"
                  }`}
                >
                  {tab.label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

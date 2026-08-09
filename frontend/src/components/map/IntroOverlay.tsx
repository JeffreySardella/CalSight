import { useState, useEffect } from "react";
import FocusTrap from "focus-trap-react";
import { safeGetItem, safeSetItem } from "../../lib/safeStorage";
import { DATA_SOURCE_COUNT } from "../../lib/dataSources";
import { useLiveCrashTotal } from "../../hooks/useLiveCrashTotal";
import logo from "../../assets/logo.webp";

const STORAGE_KEY = "calsight-intro-seen";

interface IntroOverlayProps {
  onStart: (mode: "simple" | "advanced") => void;
}

function useCountUp(target: number, duration = 1500, delay = 400): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const timeout = setTimeout(() => {
      const start = performance.now();
      const step = (now: number) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(Math.round(eased * target));
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, delay);
    return () => clearTimeout(timeout);
  }, [target, duration, delay]);
  return value;
}

const DATA_SOURCES = [
  { name: "CCRS", detail: "CHP crash reports 2016–2026" },
  { name: "SWITRS", detail: "Statewide records 2001–2015" },
  { name: "Census ACS", detail: "Demographics & income" },
  { name: "CalEnviroScreen", detail: "Environmental burden" },
  { name: "Caltrans", detail: "Traffic volumes & roads" },
  { name: "NOAA", detail: "Weather conditions" },
];

export default function IntroOverlay({ onStart }: IntroOverlayProps) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [entered, setEntered] = useState(false);

  // Animate to the LIVE total. This was frozen at 11,129,647 and drifted
  // ~214,000 crashes behind the database — the first number a visitor sees
  // was quietly the least accurate one on the site. Falls back to the last
  // known figure until the request lands, so the animation never stalls at 0.
  const liveTotal = useLiveCrashTotal();
  const crashCount = useCountUp(liveTotal, 1400, 500);
  const sourceCount = useCountUp(DATA_SOURCE_COUNT, 800, 700);
  const rowCount = useCountUp(253, 1000, 900);

  useEffect(() => {
    if (safeGetItem(STORAGE_KEY)) return;
    setVisible(true);
    requestAnimationFrame(() => setTimeout(() => setEntered(true), 50));
  }, []);

  if (!visible) return null;

  const handleStart = (mode: "simple" | "advanced") => {
    safeSetItem(STORAGE_KEY, "1");
    safeSetItem("calsight-filter-mode", mode);
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      onStart(mode);
    }, 500);
  };

  return (
    <div className={`fixed inset-0 z-[300] overflow-y-auto transition-opacity duration-500 ${exiting ? "opacity-0" : "opacity-100"}`}>
      <div className="fixed inset-0 bg-surface" />

      <FocusTrap>
      <div role="dialog" aria-modal="true" aria-label="Welcome to CalSight" className="relative z-10 min-h-full flex flex-col items-center justify-center py-12 px-4">
        <div className="w-full max-w-xl">

          {/* Header */}
          <div className={`text-center mb-10 transform transition-all duration-700 delay-100 ${entered && !exiting ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"}`}>
            <div className="flex items-center justify-center gap-3 mb-6">
              <img src={logo} alt="" className="h-10 w-auto" />
              <h1 className="font-headline text-4xl md:text-5xl font-bold text-on-surface tracking-tighter">
                CalSight
              </h1>
            </div>
            <p className="text-lg md:text-xl text-on-surface-variant leading-relaxed max-w-md mx-auto">
              Translating California's crash data into actionable insights for safer communities.
            </p>
          </div>

          {/* Stat cards */}
          <div className={`grid grid-cols-3 gap-3 mb-8 transform transition-all duration-700 delay-300 ${entered && !exiting ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"}`}>
            {[
              { value: crashCount.toLocaleString(), label: "Crash records" },
              { value: String(sourceCount), label: "Data sources" },
              { value: `${rowCount / 10}M`, label: "Total rows" },
            ].map(({ value, label }) => (
              <div key={label} className="bg-surface-container-lowest rounded-xl ambient-shadow flex flex-col items-center justify-center text-center py-5 px-3">
                <p className="font-headline text-xl md:text-2xl font-bold text-on-surface tracking-tight">
                  {value}
                </p>
                <p className="text-[9px] md:text-[10px] text-on-surface-variant uppercase tracking-widest font-semibold mt-1">
                  {label}
                </p>
              </div>
            ))}
          </div>

          {/* Data source pills */}
          <div className={`mb-10 transform transition-all duration-700 delay-500 ${entered && !exiting ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"}`}>
            <p className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant text-center mb-3">
              Powered by
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {DATA_SOURCES.map((src) => (
                <span
                  key={src.name}
                  className="text-[11px] font-semibold bg-surface-container-lowest text-on-surface-variant px-3 py-1.5 rounded-full ambient-shadow"
                  title={src.detail}
                >
                  {src.name}
                </span>
              ))}
            </div>
          </div>

          {/* Mode selection */}
          <div className={`transform transition-all duration-700 delay-700 ${entered && !exiting ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"}`}>
            <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant text-center mb-4">
              Choose your experience
            </p>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleStart("simple")}
                className="rounded-xl px-5 py-5 bg-surface-container-lowest ambient-shadow hover:bg-surface-container-low transition-all duration-200 hover:scale-[1.02] text-center"
              >
                <span className="material-symbols-outlined text-[28px] text-primary block mb-2">tune</span>
                <p className="text-on-surface font-semibold text-base">Simple</p>
                <p className="text-on-surface-variant text-xs mt-1">Quick presets & filters</p>
              </button>

              <button
                onClick={() => handleStart("advanced")}
                className="rounded-xl px-5 py-5 bg-primary-container ambient-shadow hover:bg-primary-container/80 transition-all duration-200 hover:scale-[1.02] text-center"
              >
                <span className="material-symbols-outlined text-[28px] text-on-primary-container block mb-2">settings</span>
                <p className="text-on-primary-container font-semibold text-base">Advanced</p>
                <p className="text-on-primary-container/70 text-xs mt-1">Step-by-step wizard</p>
              </button>
            </div>
          </div>

        </div>
      </div>
      </FocusTrap>
    </div>
  );
}

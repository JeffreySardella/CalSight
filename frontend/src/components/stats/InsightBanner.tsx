import { useState, useEffect, useCallback, useRef } from "react";
import type { HeroMetrics } from "../../hooks/useStats";
import type { FunFact } from "../../hooks/useFunFacts";

interface InsightBannerProps {
  heroMetrics: HeroMetrics;
  loading: boolean;
  funFacts?: FunFact[];
}

interface Slide {
  type: "yoy" | "fun_fact";
  text: string;
}

function buildYoYSlide(heroMetrics: HeroMetrics): Slide | null {
  const { incidentYoYPct, yoyFatalityChangePct } = heroMetrics;
  if (incidentYoYPct == null && yoyFatalityChangePct == null) return null;

  const parts: string[] = [];
  if (incidentYoYPct != null) {
    const direction = incidentYoYPct >= 0 ? "up" : "down";
    parts.push(`Crashes are ${direction} ${Math.abs(incidentYoYPct)}% YoY`);
  }
  if (yoyFatalityChangePct != null) {
    const direction = yoyFatalityChangePct >= 0 ? "up" : "down";
    parts.push(`fatalities are ${direction} ${Math.abs(yoyFatalityChangePct)}%`);
  }
  return { type: "yoy", text: parts.join(" — ") };
}

export default function InsightBanner({ heroMetrics, loading, funFacts = [] }: InsightBannerProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // Build slide deck: YoY slide first, then fun facts
  const slides: Slide[] = [];
  const yoySlide = buildYoYSlide(heroMetrics);
  if (yoySlide) slides.push(yoySlide);
  for (const fact of funFacts) {
    slides.push({ type: "fun_fact", text: fact.narrative });
  }

  // Reset index when slides change (e.g. new county selected)
  useEffect(() => {
    setActiveIndex(0);
  }, [slides.length]);

  // Auto-rotate every 10 seconds
  useEffect(() => {
    if (slides.length <= 1 || paused) return;
    const timer = setInterval(() => {
      setActiveIndex((i) => (i + 1) % slides.length);
    }, 10_000);
    return () => clearInterval(timer);
  }, [slides.length, paused]);

  const goNext = useCallback(() => {
    setActiveIndex((i) => (i + 1) % slides.length);
  }, [slides.length]);

  const goPrev = useCallback(() => {
    setActiveIndex((i) => (i - 1 + slides.length) % slides.length);
  }, [slides.length]);

  const touchStartX = useRef<number | null>(null);

  if (loading || slides.length === 0) return null;

  const current = slides[activeIndex % slides.length];
  const isFunFact = current.type === "fun_fact";

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 bg-surface-container-low border-l-2 border-primary rounded-lg px-4 py-3 overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchStartX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        if (dx > 40) goPrev();
        else if (dx < -40) goNext();
        touchStartX.current = null;
      }}
    >
      <span className="material-symbols-outlined text-primary text-[20px] flex-shrink-0" aria-hidden="true">
        {isFunFact ? "lightbulb" : "auto_awesome"}
      </span>
      <div className="flex-1 min-w-0">
        {isFunFact && (
          <span className="text-primary text-[11px] font-semibold uppercase tracking-wide">
            Did You Know?
          </span>
        )}
        <p className="text-on-surface text-sm font-medium min-w-0 break-words">{current.text}</p>
      </div>
      {slides.length > 1 && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous insight"
            className="p-1 rounded-full hover:bg-surface-container-high transition-colors text-on-surface-variant"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">chevron_left</span>
          </button>
          <span className="text-on-surface-variant text-[11px] tabular-nums min-w-[2.5ch] text-center">
            {activeIndex + 1}/{slides.length}
          </span>
          <button
            type="button"
            onClick={goNext}
            aria-label="Next insight"
            className="p-1 rounded-full hover:bg-surface-container-high transition-colors text-on-surface-variant"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">chevron_right</span>
          </button>
        </div>
      )}
    </div>
  );
}

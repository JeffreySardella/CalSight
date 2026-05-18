import { useState, useRef, useEffect } from "react";

function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function useInView(ref: React.RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) { setInView(true); return; }
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); io.disconnect(); } },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}

export function useChartAnimation(
  containerRef: React.RefObject<Element | null>,
  options: { duration?: number; delay?: number } = {},
): { progress: number; entered: boolean } {
  const { duration = 400, delay = 0 } = options;
  const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [progress, setProgress] = useState(reducedMotion ? 1 : 0);
  const isVisible = useInView(containerRef);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (hasAnimated.current || reducedMotion) {
      setProgress(1);
      hasAnimated.current = true;
      return;
    }
    if (!isVisible) return;
    hasAnimated.current = true;

    let startTime: number | null = null;
    let raf: number;

    const tick = (now: number) => {
      if (startTime === null) startTime = now + delay;
      const elapsed = now - startTime;
      if (elapsed < 0) { raf = requestAnimationFrame(tick); return; }
      const raw = Math.min(elapsed / duration, 1);
      setProgress(easeOutExpo(raw));
      if (raw < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isVisible, reducedMotion, duration, delay]);

  return { progress, entered: progress >= 1 };
}

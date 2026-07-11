/**
 * Motion helpers that honor the user's reduced-motion preference.
 *
 * AccessibilityContext toggles the `.reduce-motion` class on <html> from the
 * effective reduced-motion setting (explicit preference or OS). JS-driven
 * motion (smooth scrolls, Leaflet fitBounds animations, …) bypasses the CSS
 * kill-switch, so imperative call sites must check the preference here too
 * (WCAG 2.3.3 / motion hygiene).
 */

/** True when the effective reduced-motion preference is currently active. */
export function prefersReducedMotionNow(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("reduce-motion")
  );
}

/**
 * Scroll behavior for JS-driven scrolls: passing `behavior: "smooth"`
 * explicitly overrides the CSS `scroll-behavior: auto` rule, so check the
 * preference here.
 */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotionNow() ? "auto" : "smooth";
}

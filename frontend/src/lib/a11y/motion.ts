/**
 * Scroll behavior that honors the user's reduced-motion preference.
 *
 * AccessibilityContext toggles the `.reduce-motion` class on <html> from the
 * effective reduced-motion setting (explicit preference or OS). JS-driven
 * scrolls pass `behavior: "smooth"` explicitly, which overrides the CSS
 * `scroll-behavior: auto` rule — so we must check the preference here too
 * (WCAG 2.3.3 / motion hygiene).
 */
export function scrollBehavior(): ScrollBehavior {
  if (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("reduce-motion")
  ) {
    return "auto";
  }
  return "smooth";
}

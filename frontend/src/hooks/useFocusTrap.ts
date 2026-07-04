import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Make an `aria-modal` dialog behave modally: while `active`, trap keyboard
 * focus inside `ref`, close on Escape, and restore focus to whatever was
 * focused before it opened.
 *
 * This is the canonical trap first written inline in AiCompanion — extracted so
 * other dialogs (StoryCanvasPanel, …) don't reimplement it and drift. The Tab
 * handler is a native listener on the dialog node (not a JSX onKeyDown) so it
 * doesn't trip jsx-a11y's no-noninteractive-element-interactions rule; Escape
 * lives on the document so it fires wherever focus sits.
 *
 * @param ref     the dialog container (rendered while `active`, `tabIndex={-1}`)
 * @param active  whether the dialog is currently open
 * @param onClose called when Escape is pressed
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onClose?: () => void,
) {
  // Escape → close. Separate effect so a changing `onClose` identity doesn't
  // re-run the focus capture/restore below (which would steal focus mid-open).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, onClose]);

  // Focus capture + Tab trap + restore.
  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    const restore = document.activeElement as HTMLElement | null;
    node?.focus();

    const onTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !node) return;
      const focusables = node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables.length === 0) {
        // Nothing to move to — keep focus on the dialog itself.
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && (activeEl === first || activeEl === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    node?.addEventListener("keydown", onTab);
    return () => {
      node?.removeEventListener("keydown", onTab);
      restore?.focus?.();
    };
  }, [active, ref]);
}

import { useEffect, useRef } from "react";
import FocusTrap from "focus-trap-react";

interface KeyboardHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { key: "]", desc: "Next county" },
  { key: "[", desc: "Previous county" },
  { key: "Enter", desc: "Open insight card" },
  { key: "Esc", desc: "Close overlay" },
  { key: "Arrow keys", desc: "Pan map" },
  { key: "+  /  −", desc: "Zoom in / out" },
  { key: "?", desc: "Toggle this help" },
];

export default function KeyboardHelpModal({ isOpen, onClose }: KeyboardHelpModalProps) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      previousFocus.current = document.activeElement as HTMLElement;
      modalRef.current?.focus();
    } else if (previousFocus.current) {
      previousFocus.current.focus();
      previousFocus.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <FocusTrap focusTrapOptions={{ allowOutsideClick: true, escapeDeactivates: false, initialFocus: '[role="dialog"]', fallbackFocus: '[role="dialog"]' }}>
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Real button (not a div+role) so it's keyboard-operable and not a
          misleading announced-but-unreachable control. */}
      <button
        type="button"
        className="absolute inset-0 bg-on-surface/30 backdrop-blur-sm cursor-default"
        onClick={onClose}
        aria-label="Close keyboard shortcuts"
      />

      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        className="relative z-10 bg-surface-container-lowest rounded-xl p-6 w-[340px] max-w-[90vw] ambient-shadow ghost-border outline-none"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-headline font-bold text-on-surface">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-surface-container rounded-full text-on-surface-variant transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="space-y-3">
          {SHORTCUTS.map(({ key, desc }) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <kbd className="inline-flex items-center px-2.5 py-1 rounded-md bg-surface-container text-on-surface text-xs font-mono font-semibold min-w-[80px] justify-center whitespace-nowrap">
                {key}
              </kbd>
              <span className="text-sm text-on-surface-variant flex-1 text-right">
                {desc}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-5 text-[10px] text-on-surface-variant text-center uppercase tracking-widest">
          Press ? to toggle this help
        </p>
      </div>
    </div>
    </FocusTrap>
  );
}

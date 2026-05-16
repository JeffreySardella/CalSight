import { formatCombo } from "../../lib/keyboard/shortcutRegistry";

interface Props {
  /** Whether a chart is currently focused */
  chartFocused: boolean;
  /** Whether we are in builder mode */
  isBuilder: boolean;
  /** Show the bar at all (hides on mobile / when disabled) */
  visible: boolean;
}

/**
 * KeyboardHintBar — a subtle bar at the bottom of the dashboard showing
 * context-sensitive keyboard hints.
 *
 * Shown only when user has interacted with keyboard navigation.
 * Disappears on mouse interaction (keyboard-first users see it, mouse users don't).
 */
export default function KeyboardHintBar({ chartFocused, isBuilder, visible }: Props) {
  if (!visible) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="flex items-center gap-4 px-4 py-2 bg-surface-container-highest/95 backdrop-blur-sm rounded-full shadow-lg border border-outline-variant/10 text-[10px] text-on-surface-variant">
        {!chartFocused ? (
          <>
            <Hint keys="meta+k" label="Command palette" />
            <Hint keys="h" label="" />
            <Hint keys="j" label="" />
            <Hint keys="k" label="" />
            <Hint keys="l" label="Navigate charts" />
            <Hint keys="shift+?" label="All shortcuts" />
          </>
        ) : (
          <>
            <Hint keys="d" label="Data" />
            <Hint keys="t" label="Trend" />
            <Hint keys="m" label="Mean" />
            <Hint keys="e" label="Explain" />
            <Hint keys="p" label="PNG" />
            <Hint keys="c" label="CSV" />
            {isBuilder && <Hint keys="x" label="Remove" />}
            <span className="w-px h-3 bg-outline-variant/30" aria-hidden="true" />
            <Hint keys="h/j/k/l" label="Move" />
          </>
        )}
      </div>
    </div>
  );
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="px-1.5 py-0.5 bg-surface-container rounded border border-outline-variant/20 font-mono text-on-surface font-medium">
        {keys.includes("/") ? keys : formatCombo(keys)}
      </kbd>
      {label && <span>{label}</span>}
    </span>
  );
}

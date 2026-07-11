import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "../../lib/clipboard";

/**
 * Copy-link button. The whole shareable view (filters, viewport, layers) is
 * already encoded in the URL, so "share" is simply "copy window.location".
 *
 * `onBeforeShare` runs synchronously right before the URL is read — the map
 * page uses it to flush the debounced viewport into the URL so the copied
 * link reflects the live camera.
 */

type ShareStatus = "idle" | "copied" | "error";

const RESET_MS = 2000;

interface ShareButtonProps {
  /** Runs synchronously immediately before window.location is read. */
  onBeforeShare?: () => void;
  /** Render the text label beside the icon. Off → icon-only (tight rails). */
  showLabel?: boolean;
  /** Classes for the <button>, so each placement matches its surroundings. */
  className?: string;
  /** Classes for the icon glyph — mainly its size per placement. */
  iconClassName?: string;
}

export default function ShareButton({
  onBeforeShare,
  showLabel = true,
  className = "",
  iconClassName = "text-[18px]",
}: ShareButtonProps) {
  const [status, setStatus] = useState<ShareStatus>("idle");
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
  }, []);

  const handleClick = useCallback(async () => {
    onBeforeShare?.();
    const ok = await copyText(window.location.href);
    setStatus(ok ? "copied" : "error");
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setStatus("idle"), RESET_MS);
  }, [onBeforeShare]);

  const icon = status === "copied" ? "check" : status === "error" ? "error" : "share";
  const label = status === "copied" ? "Link copied" : status === "error" ? "Copy failed" : "Share";

  return (
    <button
      type="button"
      onClick={handleClick}
      title={status === "idle" ? "Copy a link to this view" : label}
      aria-label="Copy a shareable link to this view"
      className={className}
    >
      <span className={`material-symbols-outlined ${iconClassName}`} aria-hidden="true">
        {icon}
      </span>
      {showLabel && <span>{label}</span>}
      <span className="sr-only" role="status" aria-live="polite">
        {status === "copied"
          ? "Link copied to clipboard"
          : status === "error"
            ? "Copy failed"
            : ""}
      </span>
    </button>
  );
}

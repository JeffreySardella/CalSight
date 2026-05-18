/**
 * Social sharing panel for the Stats dashboard.
 *
 * Provides share buttons for common platforms and a "copy link" option.
 * Each platform gets a pre-formatted message with the current dashboard URL.
 * The URL includes the encoded dashboard config so recipients see the
 * same chart layout the sharer was viewing.
 *
 * The panel is designed as a small popover anchored to a share button.
 */

import { useState, useRef, useEffect, useCallback } from "react";

const SITE_URL = "https://calsight.org";

interface SharePanelProps {
  /** The full shareable URL (includes ?dashboard= param if applicable) */
  shareUrl: string;
  /** Short description for the share text */
  shareText?: string;
  /** Optional: compact mode for toolbar placement */
  compact?: boolean;
}

interface ShareTarget {
  name: string;
  icon: string;
  color: string;
  buildUrl: (url: string, text?: string) => string;
}

const SHARE_TARGETS: ShareTarget[] = [
  {
    name: "X (Twitter)",
    icon: "𝕏",
    color: "#000000",
    buildUrl: (url, text = "") =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
  },
  {
    name: "LinkedIn",
    icon: "in",
    color: "#0A66C2",
    buildUrl: (url) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  },
  {
    name: "Facebook",
    icon: "f",
    color: "#1877F2",
    buildUrl: (url) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
  {
    name: "Reddit",
    icon: "r/",
    color: "#FF4500",
    buildUrl: (url, text = "") =>
      `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}`,
  },
  {
    name: "Email",
    icon: "@",
    color: "#6B7280",
    buildUrl: (url, text = "") =>
      `mailto:?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(`Check out this California crash data dashboard:\n\n${url}`)}`,
  },
];

export default function SharePanel({ shareUrl, shareText, compact = false }: SharePanelProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const defaultText = shareText || "See California crash data on CalSight";

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = shareUrl;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [shareUrl]);

  const handleNativeShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "CalSight — California Crash Data",
          text: defaultText,
          url: shareUrl,
        });
      } catch {
        // User cancelled — that's fine
      }
    } else {
      setOpen(true);
    }
  }, [shareUrl, defaultText]);

  return (
    <div ref={panelRef} className="relative inline-block" data-print-hide>
      {/* Trigger button */}
      <button
        type="button"
        onClick={handleNativeShare}
        className={`inline-flex items-center gap-1.5 text-on-surface-variant hover:text-on-surface transition-colors min-w-[44px] min-h-[44px] justify-center ${
          compact
            ? "p-2"
            : "text-[11px] font-medium uppercase tracking-wider"
        }`}
        aria-label="Share dashboard"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span className="material-symbols-outlined text-[16px]">share</span>
        {!compact && <span className="hidden sm:inline">Share</span>}
      </button>

      {/* Popover panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Share options"
          className="absolute right-0 top-full mt-2 z-50 w-72 bg-surface-container-lowest rounded-xl shadow-lg border border-outline-variant/20 p-4 animate-in fade-in slide-in-from-top-1"
        >
          <h3 className="text-sm font-semibold text-on-surface mb-3">Share this dashboard</h3>

          {/* Social buttons grid */}
          <div className="grid grid-cols-5 gap-2 mb-4">
            {SHARE_TARGETS.map((target) => (
              <a
                key={target.name}
                href={target.buildUrl(shareUrl, defaultText)}
                target="_blank"
                rel="noopener noreferrer"
                title={`Share on ${target.name}`}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-surface-container-high hover:bg-surface-container-highest transition-colors text-xs font-bold text-on-surface"
                style={{ borderColor: target.color, borderWidth: "1.5px" }}
              >
                {target.icon}
              </a>
            ))}
          </div>

          {/* Copy link section */}
          <div className="flex items-stretch gap-2">
            <input
              type="text"
              readOnly
              value={shareUrl}
              className="flex-1 bg-surface-container-high rounded-lg px-3 py-2 text-xs text-on-surface-variant truncate border border-outline-variant/20 focus:outline-none"
              onClick={(e) => (e.target as HTMLInputElement).select()}
              aria-label="Share URL"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="px-3 py-2 bg-primary text-on-primary rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors whitespace-nowrap"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>

          {/* Preview hint */}
          <p className="text-[10px] text-on-surface-variant mt-3 opacity-70">
            Recipients will see your current dashboard layout and filters.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Builds the full share URL including the dashboard configuration.
 */
export function buildShareUrl(params: {
  dashboardEncoded?: string;
  path?: string;
  filters?: Record<string, string>;
}): string {
  const { dashboardEncoded, path = "/stats", filters } = params;
  const url = new URL(`${SITE_URL}${path}`);
  if (dashboardEncoded) {
    url.searchParams.set("dashboard", dashboardEncoded);
  }
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
    });
  }
  return url.toString();
}

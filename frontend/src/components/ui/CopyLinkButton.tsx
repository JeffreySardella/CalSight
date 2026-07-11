import { useToast } from "./toastContext";
import { copyText } from "../../lib/clipboard";

/**
 * Copy-current-URL affordance for the export/share flow (#256). The whole
 * shareable view (filters, viewport, layers) already lives in the URL, so
 * copying window.location is a complete share link. Feedback goes through
 * the toast system instead of a silent success.
 */

interface CopyLinkButtonProps {
  /** Runs synchronously right before the URL is read (e.g. flush viewport). */
  onBeforeCopy?: () => void;
  className?: string;
  label?: string;
}

export default function CopyLinkButton({
  onBeforeCopy,
  className,
  label = "Copy link to this view",
}: CopyLinkButtonProps) {
  const { showToast } = useToast();

  const handleClick = async () => {
    onBeforeCopy?.();
    const ok = await copyText(window.location.href);
    showToast(
      ok ? "Link copied to clipboard" : "Couldn't copy the link",
      { variant: ok ? "success" : "error" },
    );
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={
        className ??
        "w-full flex items-center justify-center gap-2 bg-surface-container-high hover:bg-surface-container-highest text-on-surface py-3 rounded-lg text-[11px] font-bold tracking-widest uppercase transition-colors"
      }
    >
      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">link</span>
      {label}
    </button>
  );
}

import { useEffect, useId, useRef, useState } from "react";
import { useToast } from "../ui/toastContext";
import {
  downloadConversation,
  type ConversationExportFormat,
} from "../../lib/export/conversation";
import type { ChatMessage } from "../../hooks/useAskAi";

/** Header control that downloads the current Ask AI conversation as Markdown
 *  or JSON (roadmap #256/#293). Renders nothing when there's no conversation.
 */
export default function ConversationExportMenu({
  messages,
}: {
  messages: ChatMessage[];
}) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Close on outside click / Escape while open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!messages.length) return null;

  const handleExport = (format: ConversationExportFormat) => {
    setOpen(false);
    try {
      downloadConversation(messages, format, new Date().toLocaleString());
      showToast(
        format === "markdown" ? "Conversation exported as Markdown" : "Conversation exported as JSON",
        { variant: "success" },
      );
    } catch {
      showToast("Couldn't export the conversation", { variant: "error" });
    }
  };

  const itemClass =
    "w-full text-left px-3 py-2 text-xs text-on-surface hover:bg-surface-container-high transition-colors flex items-center gap-2";

  return (
    <div ref={rootRef} className="relative flex-none">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-high hover:bg-surface-container text-on-surface-variant hover:text-on-surface text-xs font-medium transition-colors whitespace-nowrap"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Export conversation"
      >
        <span className="material-symbols-outlined text-sm" aria-hidden="true">
          download
        </span>
        Export
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Export format"
          className="absolute right-0 mt-1 z-20 min-w-[10rem] rounded-xl overflow-hidden bg-surface-container-lowest ghost-border ambient-shadow"
        >
          <button type="button" role="menuitem" className={itemClass} onClick={() => handleExport("markdown")}>
            <span className="material-symbols-outlined text-sm" aria-hidden="true">description</span>
            Markdown (.md)
          </button>
          <button type="button" role="menuitem" className={itemClass} onClick={() => handleExport("json")}>
            <span className="material-symbols-outlined text-sm" aria-hidden="true">data_object</span>
            JSON (.json)
          </button>
        </div>
      )}
    </div>
  );
}

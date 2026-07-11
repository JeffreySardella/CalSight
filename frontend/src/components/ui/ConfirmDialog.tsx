import { useId, useRef } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";

/**
 * Accessible confirmation dialog (#256/#293): role="alertdialog", focus
 * trapped via the shared useFocusTrap hook (Escape cancels, focus restored
 * on close). Callers should only open it when there is genuinely something
 * to lose — never as a reflex on every click.
 */

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm action as destructive (error tokens). */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const messageId = useId();
  useFocusTrap(dialogRef, open, onCancel);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* Real button (not a div+role) so the backdrop is keyboard-operable. */}
      <button
        type="button"
        className="absolute inset-0 bg-on-surface/30 backdrop-blur-sm cursor-default"
        onClick={onCancel}
        aria-label="Close dialog"
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        tabIndex={-1}
        className="relative z-10 bg-surface-container-lowest rounded-xl p-6 w-[360px] max-w-[90vw] ambient-shadow ghost-border outline-none"
      >
        <h2 id={titleId} className="text-base font-headline font-bold text-on-surface">
          {title}
        </h2>
        {message && (
          <p id={messageId} className="mt-2 text-sm text-on-surface-variant leading-relaxed">
            {message}
          </p>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-full text-sm font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-5 py-2 rounded-full text-sm font-bold transition-opacity hover:opacity-90 ${
              destructive ? "bg-error text-on-error" : "bg-primary text-on-primary"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

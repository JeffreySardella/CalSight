interface Props {
  status?: string | null;
  /** The server's progress line while it queries data ("Looking up ..."). */
  progress?: string;
}

export default function ThinkingIndicator({ status, progress }: Props) {
  const isRetrying = status && status.includes("Retrying");
  const text = isRetrying ? status : progress;

  return (
    <div
      className="flex justify-start mb-4"
      role="status"
      aria-label="AI is thinking"
    >
      <div className="bg-surface-container-lowest ghost-border rounded-xl px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 shrink-0">
            <span className="w-2 h-2 bg-on-surface-variant/40 rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-2 h-2 bg-on-surface-variant/40 rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-2 h-2 bg-on-surface-variant/40 rounded-full animate-bounce [animation-delay:300ms]" />
          </div>
          {text && (
            <span className="text-xs text-on-surface-variant">{text}</span>
          )}
        </div>
      </div>
    </div>
  );
}

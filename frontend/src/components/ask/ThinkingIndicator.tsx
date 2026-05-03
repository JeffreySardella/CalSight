export default function ThinkingIndicator() {
  return (
    <div
      className="flex justify-start mb-4"
      role="status"
      aria-label="AI is thinking"
    >
      <div className="bg-surface-container-lowest ghost-border rounded-xl px-4 py-3">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 bg-on-surface-variant/40 rounded-full animate-bounce [animation-delay:0ms]" />
          <span className="w-2 h-2 bg-on-surface-variant/40 rounded-full animate-bounce [animation-delay:150ms]" />
          <span className="w-2 h-2 bg-on-surface-variant/40 rounded-full animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

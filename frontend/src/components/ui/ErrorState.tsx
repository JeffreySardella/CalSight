interface ErrorStateProps {
  icon?: string;
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  icon = "error",
  title = "Couldn't load data",
  description = "Something went wrong. Please try again.",
  onRetry,
  className = "",
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center gap-3 text-center px-4 text-on-surface-variant ${className}`}
    >
      <span className="material-symbols-outlined text-[28px] opacity-40 text-error" aria-hidden="true">
        {icon}
      </span>
      <div>
        <p className="font-headline font-bold text-sm text-on-surface">{title}</p>
        <p className="text-sm leading-relaxed mt-0.5">{description}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="bg-primary-container text-on-primary-container px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-widest hover:opacity-90 transition-opacity"
        >
          Retry
        </button>
      )}
    </div>
  );
}

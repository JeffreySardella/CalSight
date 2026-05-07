interface EmptyStateProps {
  /** Material Symbols name. Defaults to a generic empty-inbox glyph. */
  icon?: string;
  /** Optional headline above the description. */
  title?: string;
  /** Required muted explanation of why nothing is shown. */
  description: string;
  className?: string;
}

export function EmptyState({
  icon = "inbox",
  title,
  description,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={`flex flex-col items-center justify-center gap-2 text-center px-4 text-on-surface-variant ${className}`}
    >
      <span className="material-symbols-outlined text-[28px] opacity-40" aria-hidden="true">
        {icon}
      </span>
      {title && (
        <p className="font-headline font-bold text-sm text-on-surface">{title}</p>
      )}
      <p className="text-sm leading-relaxed max-w-xs">{description}</p>
    </div>
  );
}

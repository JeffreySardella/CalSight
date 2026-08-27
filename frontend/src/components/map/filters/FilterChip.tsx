interface FilterChipProps {
  label: string;
  icon?: string;
  count?: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}

const ACTIVE = "px-3 py-1.5 rounded-full text-xs font-semibold bg-primary text-on-primary transition-colors";
const INACTIVE = "px-3 py-1.5 rounded-full text-xs font-semibold bg-surface-container-high text-on-surface-variant hover:bg-surface-variant transition-colors";
const DISABLED = "px-3 py-1.5 rounded-full text-xs font-semibold bg-surface-container-high text-on-surface-variant/40 cursor-not-allowed";

export default function FilterChip({ label, icon, count, active, disabled, onClick }: FilterChipProps) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className={`flex items-center gap-1.5 ${disabled ? DISABLED : active ? ACTIVE : INACTIVE}`}
      aria-pressed={active}
      disabled={disabled}
    >
      {icon && (
        <span className="material-symbols-outlined text-[14px]">{icon}</span>
      )}
      {label}
      {count && (
        <span className={`text-[9px] ${active ? "text-on-primary/70" : "text-on-surface-variant"}`}>
          ({count})
        </span>
      )}
    </button>
  );
}

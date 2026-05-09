interface FilterChipProps {
  label: string;
  icon?: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}

const ACTIVE = "px-3 py-1.5 rounded-full text-xs font-semibold bg-primary text-on-primary transition-all";
const INACTIVE = "px-3 py-1.5 rounded-full text-xs font-semibold bg-surface-container-high text-on-surface-variant hover:bg-surface-variant transition-all";
const DISABLED = "px-3 py-1.5 rounded-full text-xs font-semibold bg-surface-container-high text-on-surface-variant/40 cursor-not-allowed";

export default function FilterChip({ label, icon, active, disabled, onClick }: FilterChipProps) {
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
    </button>
  );
}

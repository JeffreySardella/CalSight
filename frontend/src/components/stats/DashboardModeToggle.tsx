interface Props {
  mode: "simple" | "advanced" | "stories";
  onChange: (mode: "simple" | "advanced" | "stories") => void;
}

export default function DashboardModeToggle({ mode, onChange }: Props) {
  return (
    <div role="radiogroup" aria-label="Dashboard mode" className="flex rounded-full bg-surface-container-high p-0.5 text-xs font-medium">
      <button
        onClick={() => onChange("simple")}
        role="radio"
        aria-checked={mode === "simple"}
        className={`px-4 py-2.5 rounded-full transition-colors min-h-[44px] flex items-center ${
          mode === "simple"
            ? "bg-primary text-on-primary"
            : "text-on-surface-variant hover:text-on-surface"
        }`}
      >
        Presets
      </button>
      <button
        onClick={() => onChange("advanced")}
        role="radio"
        aria-checked={mode === "advanced"}
        className={`px-4 py-2.5 rounded-full transition-colors min-h-[44px] flex items-center ${
          mode === "advanced"
            ? "bg-primary text-on-primary"
            : "text-on-surface-variant hover:text-on-surface"
        }`}
      >
        Builder
      </button>
      <button
        onClick={() => onChange("stories")}
        role="radio"
        aria-checked={mode === "stories"}
        className={`px-4 py-2.5 rounded-full transition-colors min-h-[44px] flex items-center ${
          mode === "stories"
            ? "bg-primary text-on-primary"
            : "text-on-surface-variant hover:text-on-surface"
        }`}
      >
        Stories
      </button>
    </div>
  );
}

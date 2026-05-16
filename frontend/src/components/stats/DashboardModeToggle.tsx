interface Props {
  mode: "simple" | "advanced";
  onChange: (mode: "simple" | "advanced") => void;
}

export default function DashboardModeToggle({ mode, onChange }: Props) {
  return (
    <div role="radiogroup" aria-label="Dashboard mode" className="flex rounded-full bg-surface-container-high p-0.5 text-xs font-medium">
      <button
        onClick={() => onChange("simple")}
        role="radio"
        aria-checked={mode === "simple"}
        className={`px-4 py-2 rounded-full transition-colors ${
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
        className={`px-4 py-2 rounded-full transition-colors ${
          mode === "advanced"
            ? "bg-primary text-on-primary"
            : "text-on-surface-variant hover:text-on-surface"
        }`}
      >
        Builder
      </button>
    </div>
  );
}

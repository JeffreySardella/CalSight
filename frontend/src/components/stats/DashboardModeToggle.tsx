interface Props {
  mode: "simple" | "advanced";
  onChange: (mode: "simple" | "advanced") => void;
}

export default function DashboardModeToggle({ mode, onChange }: Props) {
  return (
    <div className="flex rounded-full bg-surface-container-high p-0.5 text-xs font-medium">
      <button
        onClick={() => onChange("simple")}
        className={`px-4 py-1.5 rounded-full transition-colors ${
          mode === "simple"
            ? "bg-primary text-on-primary"
            : "text-on-surface-variant hover:text-on-surface"
        }`}
      >
        Presets
      </button>
      <button
        onClick={() => onChange("advanced")}
        className={`px-4 py-1.5 rounded-full transition-colors ${
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

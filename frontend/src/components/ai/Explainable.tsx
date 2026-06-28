import type { ReactNode } from "react";
import type { DataContext } from "../../lib/ai/dataContext";
import { useAiCompanion } from "./AiCompanion";

export function Explainable({
  context, children, className,
}: { context: DataContext; children: ReactNode; className?: string }) {
  const { open } = useAiCompanion();
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Explain: ${context.label}`}
      onClick={() => open(context)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open(context);
        }
      }}
      className={`cursor-help underline decoration-dotted decoration-on-surface-variant/40 underline-offset-2 hover:decoration-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${className ?? ""}`}
    >
      {children}
    </span>
  );
}

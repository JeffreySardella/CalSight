import type { ReactNode } from "react";

interface SidePanelProps {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export default function SidePanel({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: SidePanelProps) {
  return (
    <aside className="w-[300px] bg-surface-container-lowest h-full flex flex-col overflow-hidden transition-all duration-300 relative">
      {/* Header */}
      <div className="p-6 flex justify-between items-center">
        <div>
          <h2 className="font-headline text-lg font-bold tracking-tight text-on-surface">
            {title}
          </h2>
          <p className="text-[10px] uppercase tracking-widest text-on-surface-variant font-medium">
            {subtitle}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-surface-container rounded-full text-on-surface-variant flex items-center justify-center transition-colors"
        >
          <span className="material-symbols-outlined text-sm">
            arrow_back_ios
          </span>
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-6 space-y-8 pb-10">
        {children}
      </div>

      {/* Optional sticky footer */}
      {footer && (
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-surface-container-lowest via-surface-container-lowest to-transparent">
          {footer}
        </div>
      )}
    </aside>
  );
}

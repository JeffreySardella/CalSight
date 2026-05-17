import { useRef, useLayoutEffect, useState } from "react";

interface TooltipProps {
  x: number;
  y: number;
  visible: boolean;
  children: React.ReactNode;
  /** @deprecated no longer needed — kept for backwards compat */
  containerRef?: React.RefObject<SVGSVGElement | null>;
}

/**
 * Chart tooltip positioned via screen coordinates (clientX/clientY).
 * All chart components pass raw MouseEvent clientX/clientY so no
 * SVG-relative conversion is needed — eliminates offset bugs from
 * CSS transforms, flex centering, or stale bounding rects.
 */
export default function ChartTooltip({ x, y, visible, children }: TooltipProps) {
  const tipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!visible || !tipRef.current) return;
    const tipRect = tipRef.current.getBoundingClientRect();
    let left = x - tipRect.width / 2;
    let top = y - tipRect.height - 12;
    if (left < 4) left = 4;
    if (left + tipRect.width > window.innerWidth - 4) left = window.innerWidth - tipRect.width - 4;
    if (top < 4) top = y + 16;
    setPos({ left, top });
  }, [x, y, visible]);

  if (!visible) return null;

  return (
    <div
      ref={tipRef}
      aria-hidden="true"
      className="fixed z-50 pointer-events-none bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded px-3 py-2 text-xs ambient-shadow"
      style={{ left: pos.left, top: pos.top }}
    >
      {children}
    </div>
  );
}

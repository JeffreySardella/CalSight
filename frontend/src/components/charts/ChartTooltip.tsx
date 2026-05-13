import { useState, useRef, useEffect } from "react";

interface TooltipProps {
  x: number;
  y: number;
  visible: boolean;
  children: React.ReactNode;
  containerRef: React.RefObject<SVGSVGElement | null>;
}

export default function ChartTooltip({ x, y, visible, children, containerRef }: TooltipProps) {
  const tipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useEffect(() => {
    if (!visible || !containerRef.current || !tipRef.current) return;
    const svgRect = containerRef.current.getBoundingClientRect();
    const tipRect = tipRef.current.getBoundingClientRect();
    let left = svgRect.left + x - tipRect.width / 2;
    let top = svgRect.top + y - tipRect.height - 8;
    if (left < 4) left = 4;
    if (left + tipRect.width > window.innerWidth - 4) left = window.innerWidth - tipRect.width - 4;
    if (top < 4) top = svgRect.top + y + 12;
    setPos({ left, top });
  }, [x, y, visible, containerRef]);

  if (!visible) return null;

  return (
    <div
      ref={tipRef}
      className="fixed z-50 pointer-events-none bg-surface-container-lowest border border-outline-variant/15 rounded px-3 py-2 text-xs ambient-shadow"
      style={{ left: pos.left, top: pos.top }}
    >
      {children}
    </div>
  );
}

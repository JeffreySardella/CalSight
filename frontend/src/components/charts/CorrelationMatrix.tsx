import { useState } from "react";
import type { CorrelationField } from "../../hooks/useCorrelationData";

interface Props {
  fields: CorrelationField[];
  matrix: number[][];
  countyCount: number;
}

function colorForR(r: number): string {
  if (r >= 0.7) return "#1d4ed8";
  if (r >= 0.4) return "#3b82f6";
  if (r >= 0.2) return "#93c5fd";
  if (r > -0.2) return "#e5e7eb";
  if (r > -0.4) return "#fca5a5";
  if (r > -0.7) return "#ef4444";
  return "#991b1b";
}

function textColorForR(r: number): string {
  const abs = Math.abs(r);
  return abs >= 0.4 ? "#fff" : "rgb(var(--on-surface))";
}

export default function CorrelationMatrix({ fields, matrix, countyCount }: Props) {
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null);
  const n = fields.length;
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const cellSize = isMobile ? 24 : 38;
  const labelW = isMobile ? 56 : 80;
  const svgW = labelW + n * cellSize;
  const svgH = labelW + n * cellSize;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-headline font-bold text-on-surface">Correlation Matrix</h3>
          <p className="text-[10px] text-on-surface-variant">Pearson r across {countyCount} California counties</p>
        </div>
        <div className="flex items-center gap-2 text-[9px] text-on-surface-variant">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: "#991b1b" }} />
            <span>-1</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: "#e5e7eb" }} />
            <span>0</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: "#1d4ed8" }} />
            <span>+1</span>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg width={svgW} height={svgH} className="block">
          {fields.map((f, i) => (
            <text
              key={`row-${i}`}
              x={labelW - 4}
              y={labelW + i * cellSize + cellSize / 2 + 3}
              textAnchor="end"
              fontSize={9}
              fontWeight={600}
              fill="rgb(var(--on-surface-variant))"
              fontFamily="'Inter Variable', Inter, sans-serif"
            >
              {f.label}
            </text>
          ))}

          {fields.map((f, j) => (
            <text
              key={`col-${j}`}
              x={labelW + j * cellSize + cellSize / 2}
              y={labelW - 6}
              textAnchor="end"
              fontSize={9}
              fontWeight={600}
              fill="rgb(var(--on-surface-variant))"
              fontFamily="'Inter Variable', Inter, sans-serif"
              transform={`rotate(-45, ${labelW + j * cellSize + cellSize / 2}, ${labelW - 6})`}
            >
              {f.label}
            </text>
          ))}

          {matrix.map((row, i) =>
            row.map((r, j) => {
              const x = labelW + j * cellSize;
              const y = labelW + i * cellSize;
              const isHovered = hover?.i === i && hover?.j === j;
              return (
                <g
                  key={`${i}-${j}`}
                  onMouseEnter={() => setHover({ i, j })}
                  onMouseLeave={() => setHover(null)}
                  className="cursor-pointer"
                >
                  <rect
                    x={x + 1}
                    y={y + 1}
                    width={cellSize - 2}
                    height={cellSize - 2}
                    rx={3}
                    fill={colorForR(r)}
                    opacity={isHovered ? 1 : 0.85}
                    stroke={isHovered ? "rgb(var(--on-surface))" : "none"}
                    strokeWidth={isHovered ? 2 : 0}
                  />
                  <text
                    x={x + cellSize / 2}
                    y={y + cellSize / 2 + 4}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={700}
                    fill={textColorForR(r)}
                    fontFamily="'Inter Variable', Inter, sans-serif"
                  >
                    {r === 1 ? "1" : r.toFixed(2)}
                  </text>
                </g>
              );
            }),
          )}
        </svg>
      </div>

      {hover && (
        <p className="text-xs text-on-surface-variant text-center">
          <span className="font-bold text-on-surface">{fields[hover.i].label}</span>
          {" × "}
          <span className="font-bold text-on-surface">{fields[hover.j].label}</span>
          {" = "}
          <span className="font-bold" style={{ color: colorForR(matrix[hover.i][hover.j]) }}>
            r = {matrix[hover.i][hover.j].toFixed(2)}
          </span>
          {Math.abs(matrix[hover.i][hover.j]) >= 0.7 && " (strong)"}
          {Math.abs(matrix[hover.i][hover.j]) >= 0.4 && Math.abs(matrix[hover.i][hover.j]) < 0.7 && " (moderate)"}
          {Math.abs(matrix[hover.i][hover.j]) < 0.2 && " (weak)"}
        </p>
      )}
    </div>
  );
}

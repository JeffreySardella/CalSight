import { Skeleton } from "../ui/Skeleton";

type ChartType = "bar" | "donut" | "line" | "scatter" | "treemap" | "gauge" | "radar" | "polar" | "lollipop" | "stat" | "hbar" | "area";

interface Props {
  type: ChartType;
  height?: number;
}

export default function ChartSkeleton({ type, height = 192 }: Props) {
  switch (type) {
    case "bar":
      return (
        <div className="flex items-end gap-1.5 px-2" style={{ height }} aria-hidden="true">
          {[65, 45, 80, 55, 70, 40, 90, 60].map((h, i) => (
            <Skeleton key={i} className="flex-1 rounded-sm" style={{ height: `${h}%` }} />
          ))}
        </div>
      );
    case "hbar":
      return (
        <div className="flex flex-col gap-2 px-2 justify-center" style={{ height }} aria-hidden="true">
          {[75, 55, 90, 40, 65].map((w, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="w-16 h-3 rounded" />
              <Skeleton className="h-4 rounded" style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
      );
    case "donut":
      return (
        <div className="flex justify-center items-center" style={{ height }} aria-hidden="true">
          <Skeleton className="w-32 h-32 rounded-full" />
        </div>
      );
    case "line":
    case "area":
      return (
        <div className="relative px-2" style={{ height }} aria-hidden="true">
          <Skeleton className="absolute inset-x-2 bottom-4 h-0.5 rounded" />
          <svg className="w-full h-full opacity-30" preserveAspectRatio="none" viewBox="0 0 100 50">
            <path d="M 0 40 Q 15 35, 25 30 T 50 20 T 75 25 T 100 15" fill="none"
              stroke="rgb(var(--surface-container-high))" strokeWidth="2" />
          </svg>
        </div>
      );
    case "scatter":
      return (
        <div className="relative px-2" style={{ height }} aria-hidden="true">
          {[{ x: 20, y: 30 }, { x: 35, y: 55 }, { x: 50, y: 25 }, { x: 65, y: 60 }, { x: 80, y: 40 }].map((p, i) => (
            <Skeleton key={i} className="absolute w-3 h-3 rounded-full" style={{ left: `${p.x}%`, top: `${p.y}%` }} />
          ))}
        </div>
      );
    case "treemap":
      return (
        <div className="grid grid-cols-3 grid-rows-2 gap-1 p-1" style={{ height }} aria-hidden="true">
          <Skeleton className="col-span-2 rounded" />
          <Skeleton className="rounded" />
          <Skeleton className="rounded" />
          <Skeleton className="col-span-2 rounded" />
        </div>
      );
    case "gauge":
      return (
        <div className="flex flex-col items-center justify-center" style={{ height }} aria-hidden="true">
          <Skeleton className="w-40 h-20 rounded-t-full" />
          <Skeleton className="w-12 h-4 mt-2 rounded" />
        </div>
      );
    case "radar":
    case "polar":
      return (
        <div className="flex justify-center items-center" style={{ height }} aria-hidden="true">
          <Skeleton className="w-36 h-36 rounded-full" />
        </div>
      );
    case "lollipop":
      return (
        <div className="flex flex-col gap-3 px-2 justify-center" style={{ height }} aria-hidden="true">
          {[70, 50, 85, 35, 60].map((w, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="w-16 h-3 rounded" />
              <Skeleton className="h-0.5 rounded" style={{ width: `${w}%` }} />
              <Skeleton className="w-3 h-3 rounded-full flex-shrink-0" />
            </div>
          ))}
        </div>
      );
    case "stat":
      return (
        <div className="flex flex-col items-center justify-center gap-3" style={{ height }} aria-hidden="true">
          <Skeleton className="w-24 h-10 rounded" />
          <Skeleton className="w-32 h-3 rounded" />
          <div className="w-full max-w-[200px] space-y-2 mt-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="w-full h-3 rounded" />)}
          </div>
        </div>
      );
    default:
      return <Skeleton className="w-full rounded-lg" style={{ height }} />;
  }
}

interface HeatmapInfoBadgeProps {
  totalCrashes: number;
  isLoading: boolean;
}

export default function HeatmapInfoBadge({ totalCrashes, isLoading }: HeatmapInfoBadgeProps) {
  if (!isLoading && totalCrashes === 0) return null;

  return (
    <div className="absolute top-2 left-2 md:top-auto md:bottom-4 md:left-4 z-20 bg-surface-container-lowest/90 backdrop-blur-md px-3 py-1.5 rounded-full text-on-surface text-xs font-medium ghost-border">
      {isLoading ? (
        <span className="text-on-surface-variant">Loading heatmap...</span>
      ) : (
        <span>{totalCrashes.toLocaleString()} crashes</span>
      )}
    </div>
  );
}

interface AiInsightCardProps {
  onClose: () => void;
}

export default function AiInsightCard({ onClose }: AiInsightCardProps) {
  return (
    <div className="fixed bottom-24 left-4 right-4 md:absolute md:bottom-auto md:left-auto md:right-[10%] md:top-[25%] z-30 md:w-[340px] bg-surface-container-lowest/90 backdrop-blur-md p-6 rounded-xl ambient-shadow ghost-border flex flex-col gap-4">
      {/* Header */}
      <div className="flex justify-between items-start">
        <span className="text-[10px] font-bold text-primary uppercase tracking-[0.2em]">
          AI Insight
        </span>
        <button
          onClick={onClose}
          className="p-1 hover:bg-surface-container rounded-full text-on-surface-variant transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      {/* Title + description */}
      <div className="space-y-1">
        <h3 className="font-headline text-2xl font-bold text-on-surface tracking-tight leading-tight">
          Fresno County
        </h3>
        <p className="text-xs text-on-surface-variant leading-relaxed">
          Significant increase in commercial traffic detected along the CA-99
          corridor. Predictive models suggest a 12% rise in infrastructure
          fatigue over the next fiscal quarter.
        </p>
      </div>

      {/* 2-column metrics */}
      <div className="grid grid-cols-2 gap-4 py-2">
        <div className="bg-surface-container-low/50 p-3 rounded-lg">
          <p className="text-[9px] text-on-surface-variant font-bold uppercase tracking-widest mb-1">
            Total Crashes
          </p>
          <p className="text-lg font-bold text-on-surface">2,847</p>
        </div>
        <div className="bg-surface-container-low/50 p-3 rounded-lg">
          <p className="text-[9px] text-on-surface-variant font-bold uppercase tracking-widest mb-1">
            YoY Trend
          </p>
          <p className="text-lg font-bold text-error">-3.1%</p>
        </div>
      </div>

      {/* CTA */}
      <button className="w-full bg-primary-container text-on-primary-container py-3 rounded-lg text-[11px] font-bold tracking-widest uppercase hover:opacity-90 transition-opacity">
        View Full Stats
      </button>
    </div>
  );
}

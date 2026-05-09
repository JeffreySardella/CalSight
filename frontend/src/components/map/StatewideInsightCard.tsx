import { useState } from "react";
import type { RandomInsightCard } from "../../hooks/useRandomInsight";

interface StatewideInsightCardProps {
  card: RandomInsightCard;
  onRefresh: () => void;
  searchOpen?: boolean;
}

const ANGLE_LABELS: Record<string, string> = {
  overview: "Overview",
  dui: "DUI Trends",
  cause_focus: "Top Causes",
  trend: "Trend Analysis",
  comparison: "Comparison",
  unique_factor: "Notable Factor",
  safety_ranking: "Safety Ranking",
  fun_fact: "Fun Fact",
  fun_fact_records: "Fun Fact",
  fun_fact_surprising: "Fun Fact",
  county_spotlight: "Spotlight",
  surprising_stat: "Surprise",
  historical_context: "History",
  fatality_paradox: "Fatality",
  speeding: "Speeding",
  urban_rural: "Urban vs Rural",
  time_of_day: "Time of Day",
  cause_breakdown: "Causes",
  economic: "Economic",
  pedestrian: "Pedestrian",
};

export default function StatewideInsightCard({
  card,
  onRefresh,
  searchOpen,
}: StatewideInsightCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const mobileLimit = 100;
  const desktopLimit = 200;
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const limit = isMobile ? mobileLimit : desktopLimit;
  const shouldTruncate = card.narrative.length > limit;
  const displayText = shouldTruncate && !expanded
    ? card.narrative.slice(0, limit) + "..."
    : card.narrative;

  return (
    <div
      className={`absolute bottom-card-mobile left-0 right-0 z-20 md:bottom-2 md:left-16 md:right-auto md:w-[400px] md:z-30 transition-opacity duration-200 ${searchOpen ? "opacity-0 pointer-events-none" : ""}`}
    >
      <div className="bg-surface-container-lowest/95 backdrop-blur-md ghost-border md:rounded-xl overflow-hidden max-h-[40vh] md:max-h-none overflow-y-auto">
        <div className="px-3 py-2.5 md:px-4 md:py-3 space-y-1.5 md:space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className="material-symbols-outlined text-[16px] text-primary shrink-0">
                auto_awesome
              </span>
              <h3 className="font-headline text-sm font-bold text-on-surface tracking-tight truncate">
                California Insight
              </h3>
              <span className="text-[10px] text-on-surface-variant bg-surface-container px-1.5 py-0.5 rounded-full shrink-0">
                {ANGLE_LABELS[card.angle] ?? card.angle}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={onRefresh}
                className="p-1.5 hover:bg-surface-container rounded-full text-on-surface-variant transition-colors"
                title="Show another insight"
              >
                <span className="material-symbols-outlined text-[16px]">refresh</span>
              </button>
              <button
                onClick={() => setDismissed(true)}
                className="p-1.5 hover:bg-surface-container rounded-full text-on-surface-variant transition-colors md:hidden"
                aria-label="Dismiss insight"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
          </div>
          <p className="text-xs text-on-surface-variant font-body leading-relaxed">
            {displayText}
            {shouldTruncate && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="ml-1 text-primary text-[11px] font-semibold hover:underline"
              >
                {expanded ? "Show less" : "Read more"}
              </button>
            )}
          </p>
          <p className="text-[10px] text-on-surface-variant/60">{card.year}</p>
        </div>
      </div>
    </div>
  );
}

const guidedTopics = [
  {
    icon: "speed",
    title: "Velocity Impact",
    question:
      "\u201CWhat is the average speed in fatal pedestrian collisions?\u201D",
  },
  {
    icon: "schedule",
    title: "Temporal Trends",
    question:
      "\u201CWhich day of the week has the lowest accident rate?\u201D",
  },
  {
    icon: "visibility",
    title: "Visibility Analysis",
    question:
      "\u201CHow did fog affect Bay Area crashes last winter?\u201D",
  },
  {
    icon: "pedal_bike",
    title: "Active Transport",
    question:
      "\u201CList bicycle collision hotspots in Santa Clara County.\u201D",
  },
] as const;

const communityInquiries = [
  "Comparison of drunk driving incidents: 2022 vs 2023",
  "Heatmap of school zone violations in Orange County",
  "Effectiveness of new roundabout intersections in Fresno",
  "Most dangerous highway exits in San Francisco",
  "Top causes of multi-vehicle pileups in Central Valley",
] as const;

import { useState } from "react";

export default function AskAiPage() {
  const [inputValue, setInputValue] = useState("");
  return (
    <div className="max-w-[840px] mx-auto px-6 pt-32 pb-24 min-h-screen">
      {/* Header */}
      <section className="mb-12 text-center md:text-left">
        <h1 className="font-headline text-4xl md:text-5xl font-extrabold tracking-tighter text-on-surface mb-2">
          Ask AI
        </h1>
        <div className="mb-4 inline-block">
          <span className="inline-block bg-tertiary-container text-on-tertiary-container text-[10px] font-bold tracking-widest uppercase px-3 py-1 rounded-full">
            Coming Soon
          </span>
        </div>
        <p className="text-on-surface-variant text-lg max-w-2xl font-light">
          Synthesize complex California traffic safety data into clear,
          actionable insights through natural language processing.
        </p>
      </section>

      {/* Search Input */}
      <section className="mb-12">
        <div className="relative flex items-center bg-surface-container-high rounded-xl p-2 group transition-all duration-300 focus-within:ring-2 focus-within:ring-primary/20">
          <span className="material-symbols-outlined ml-4 text-on-surface-variant">
            auto_awesome
          </span>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="w-full bg-transparent border-none focus:ring-0 px-4 py-3 text-on-surface placeholder:text-outline font-body text-lg"
            placeholder="Ask a question about California crash data..."
          />
          <button
            type="button"
            onClick={() => {
              if (inputValue.trim()) {
                console.log("Analyzing:", inputValue);
                alert(`Analyzing: ${inputValue}`);
              }
            }}
            className="bg-primary text-on-primary px-6 py-3 rounded-lg flex items-center gap-2 hover:opacity-95 transition-all active:scale-[0.98]"
          >
            <span className="font-medium">Analyze</span>
            <span className="material-symbols-outlined text-sm">send</span>
          </button>
        </div>
      </section>

      {/* AI Response Area */}
      <section className="mb-16">
        <div className="bg-surface-container-lowest rounded-xl p-8 ghost-border ambient-shadow">
          {/* Badge row */}
          <div className="flex items-center gap-2 mb-6">
            <span className="bg-tertiary-container text-on-tertiary-container px-3 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase">
              AI Insight
            </span>
            <div className="h-[1px] flex-grow bg-outline-variant/10" />
          </div>

          {/* Content */}
          <div className="mb-8">
            <h2 className="font-headline text-2xl font-bold text-on-surface mb-6">
              Regional Crash Analysis: 2023 Trends
            </h2>
            <p className="text-on-surface-variant leading-relaxed mb-8">
              Based on the SWITRS dataset, urban areas in California saw a 4.2%
              shift in high-velocity collisions. Here is the breakdown of the
              most impacted regions:
            </p>

            {/* Metric Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* #1 Los Angeles */}
              <div className="bg-surface-container p-5 rounded-lg">
                <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1 block">
                  #1 Los Angeles
                </span>
                <div className="font-headline text-3xl font-extrabold text-on-surface">
                  1,402
                </div>
                <span className="text-xs text-error font-medium flex items-center mt-1">
                  <span className="material-symbols-outlined text-sm">
                    trending_up
                  </span>{" "}
                  +2.1%
                </span>
              </div>

              {/* #2 San Diego */}
              <div className="bg-surface-container-low p-5 rounded-lg">
                <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1 block">
                  #2 San Diego
                </span>
                <div className="font-headline text-3xl font-extrabold text-on-surface">
                  894
                </div>
                <span className="text-xs text-on-surface-variant font-medium flex items-center mt-1">
                  <span className="material-symbols-outlined text-sm">
                    horizontal_rule
                  </span>{" "}
                  0.0%
                </span>
              </div>

              {/* #3 Sacramento */}
              <div className="bg-surface-container-low p-5 rounded-lg">
                <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1 block">
                  #3 Sacramento
                </span>
                <div className="font-headline text-3xl font-extrabold text-on-surface">
                  621
                </div>
                <span className="text-xs text-secondary font-medium flex items-center mt-1">
                  <span className="material-symbols-outlined text-sm">
                    trending_down
                  </span>{" "}
                  -1.4%
                </span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="bg-primary-container text-on-primary-container px-5 py-2.5 rounded-md text-sm font-semibold flex items-center gap-2 hover:bg-primary-container/80 transition-all"
            >
              <span className="material-symbols-outlined text-sm">map</span>
              View on Map
            </button>
            <button
              type="button"
              className="bg-surface-container-high text-on-surface px-5 py-2.5 rounded-md text-sm font-semibold hover:bg-surface-container-highest transition-all"
            >
              Ask Another Question
            </button>
          </div>
        </div>
      </section>

      {/* Guided Topics */}
      <section className="mb-16">
        <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-[0.2em] mb-6">
          Explore Guided Topics
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {guidedTopics.map((topic) => (
            <div
              key={topic.title}
              onClick={() => setInputValue(topic.question.replace(/\u201C|\u201D/g, ""))}
              className="p-6 rounded-xl bg-surface-container-lowest hover:bg-surface-container transition-colors cursor-pointer group"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 bg-surface-container-high rounded-lg text-on-surface-variant group-hover:bg-primary group-hover:text-on-primary transition-all">
                  <span className="material-symbols-outlined">
                    {topic.icon}
                  </span>
                </div>
                <div>
                  <h4 className="font-bold text-on-surface mb-1">
                    {topic.title}
                  </h4>
                  <p className="text-sm text-on-surface-variant">
                    {topic.question}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Frequently Asked / Community Inquiries */}
      <section className="mb-16">
        <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-[0.2em] mb-6">
          Recent Community Inquiries
        </h3>
        <ul className="space-y-1">
          {communityInquiries.map((question) => (
            <li
              key={question}
              onClick={() => setInputValue(question)}
              className="group flex items-center justify-between p-4 rounded-md hover:bg-surface-container-high transition-all cursor-pointer"
            >
              <div className="flex items-center gap-4">
                <span className="material-symbols-outlined text-primary/40 group-hover:text-primary transition-colors">
                  lightbulb
                </span>
                <span className="text-on-surface text-sm font-medium">
                  {question}
                </span>
              </div>
              <span className="material-symbols-outlined text-outline-variant opacity-0 group-hover:opacity-100 transition-opacity">
                chevron_right
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Disclaimer */}
      <footer className="text-center pt-8 border-t border-outline-variant/10">
        <p className="text-[11px] text-on-surface-variant/60 italic font-body tracking-tight">
          Disclaimer: CalSight AI outputs are generated through large language
          models using public state datasets. AI can hallucinate; please verify
          critical data with official CHP and Caltrans publications.
        </p>
      </footer>
    </div>
  );
}

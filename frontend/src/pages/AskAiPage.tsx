import { useState, useRef, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAskAi } from "../hooks/useAskAi";
import { useFilterParams } from "../hooks/useFilterParams";
import ChatMessage from "../components/ask/ChatMessage";
import SuggestionChips from "../components/ask/SuggestionChips";
import ThinkingIndicator from "../components/ask/ThinkingIndicator";

function buildGuidedTopics(county: string | null, year: string | null) {
  const area = county || "California";
  const yr = year || "2016";
  return [
    { icon: "schedule", title: "Temporal Trends", question: `Which day of the week has the most crashes in ${area}?` },
    { icon: "local_bar", title: "DUI Analysis", question: county ? `What is the DUI crash rate in ${area}?` : "How does Kern County's DUI rate compare to the state average?" },
    { icon: "trending_up", title: "Year-over-Year", question: `How have fatal crashes trended in ${area} since ${yr}?` },
    { icon: "pedal_bike", title: "Vulnerable Road Users", question: county ? `How many pedestrian crashes happen in ${area}?` : "Which county has the highest pedestrian fatality rate?" },
  ];
}

function buildPopularQuestions(county: string | null) {
  if (county) {
    return [
      `What are the top crash causes in ${county}?`,
      `What time of day do most fatal crashes happen in ${county}?`,
      `What is the most dangerous road in ${county}?`,
      `How has ${county} crash rate changed over the last 5 years?`,
      `Show me a chart of crash severity in ${county}`,
    ];
  }
  return [
    "Compare DUI crash rates between LA, Orange, and San Diego counties",
    "What time of day do most fatal crashes happen statewide?",
    "How did COVID affect crash rates statewide?",
    "Which counties have the worst hit-and-run rates?",
    "What's the relationship between poverty rate and crash fatalities?",
  ];
}

export default function AskAiPage() {
  const [inputValue, setInputValue] = useState("");
  const { messages, isLoading, error, cooldownEnd, sendMessage, retry, clearConversation } = useAskAi();
  const { selectedCounties, selectedDateRange, selectedSeverities, selectedCauses, selectedAlcohol, selectedDistracted } = useFilterParams();
  const [searchParams] = useSearchParams();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  const hasMessages = messages.length > 0;

  // Read pre-filled question from URL (e.g. from "Explain this chart" button)
  const prefillHandled = useRef(false);
  useEffect(() => {
    if (prefillHandled.current) return;
    const q = searchParams.get("q");
    if (q && !hasMessages) {
      prefillHandled.current = true;
      setInputValue(q);
      // Remove q from URL without adding a history entry
      window.history.replaceState({}, "", window.location.pathname);
      // Auto-send after a brief tick so the UI renders the question first
      setTimeout(() => {
        sendMessage(q);
        setInputValue("");
      }, 0);
    }
  }, [searchParams, hasMessages, sendMessage]);

  const activeCounty = selectedCounties.size === 1 ? [...selectedCounties][0] : null;
  const activeYear = selectedDateRange?.start
    ? String(selectedDateRange.start.year)
    : selectedDateRange?.end
      ? String(selectedDateRange.end.year)
      : null;

  const guidedTopics = useMemo(() => buildGuidedTopics(activeCounty, activeYear), [activeCounty, activeYear]);
  const communityInquiries = useMemo(() => buildPopularQuestions(activeCounty), [activeCounty]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000));
      setCooldownRemaining(remaining);
    }, 500);
    return () => clearInterval(interval);
  }, [cooldownEnd]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = el.scrollHeight + "px";
  }, [inputValue]);

  const handleSend = () => {
    if (!inputValue.trim() || isLoading || cooldownRemaining > 0) return;
    sendMessage(inputValue);
    setInputValue("");
  };

  const handleSuggestionClick = (question: string) => {
    setInputValue(question);
  };

  const filterSummary = (() => {
    const parts: string[] = [];
    if (selectedCounties.size > 0) {
      parts.push(selectedCounties.size <= 2 ? [...selectedCounties].join(", ") : `${selectedCounties.size} counties`);
    }
    if (selectedDateRange) {
      const fmt = (ym: { year: number; month: number } | null) =>
        ym ? `${ym.year}-${String(ym.month).padStart(2, "0")}` : null;
      const s = fmt(selectedDateRange.start);
      const e = fmt(selectedDateRange.end);
      if (s || e) parts.push(`${s ?? "earliest"} → ${e ?? "latest"}`);
    }
    if (selectedSeverities.size > 0) {
      parts.push(selectedSeverities.size <= 2 ? [...selectedSeverities].join(", ") : `${selectedSeverities.size} severities`);
    }
    if (selectedCauses.size > 0) {
      parts.push(selectedCauses.size <= 2 ? [...selectedCauses].join(", ") : `${selectedCauses.size} causes`);
    }
    if (selectedAlcohol) parts.push("Alcohol");
    if (selectedDistracted) parts.push("Distracted");
    return parts.length > 0 ? parts.join(" · ") : "All California data";
  })();

  return (
    <div className="flex flex-col h-full max-w-[840px] mx-auto w-full">
      {/* STICKY HEADER */}
      <div className="flex-none flex items-center justify-between px-3 md:px-6 py-2 md:py-3 border-b border-outline-variant bg-surface z-10">
        <div className="min-w-0">
          <h1 className="font-headline text-lg md:text-2xl font-extrabold tracking-tighter text-on-surface">
            Ask AI
          </h1>
          <p className="text-[10px] md:text-xs text-on-surface-variant truncate">
            {filterSummary}
          </p>
        </div>
        {hasMessages && (
          <button
            type="button"
            onClick={clearConversation}
            className="flex-none flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-high hover:bg-surface-container text-on-surface-variant hover:text-on-surface text-xs font-medium transition-colors whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            New Chat
          </button>
        )}
      </div>

      {/* SCROLLABLE MESSAGE AREA */}
      <div className="flex-1 overflow-y-auto px-3 md:px-6 py-4" role="log" aria-live="polite" aria-label="AI conversation">
        {!hasMessages ? (
          <>
            <section className="mb-8">
              <h2 className="text-xs font-bold text-on-surface-variant uppercase tracking-[0.2em] mb-4">
                Explore Topics
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {guidedTopics.map((topic) => (
                  <button
                    key={topic.title}
                    type="button"
                    onClick={() => handleSuggestionClick(topic.question)}
                    className="p-4 rounded-xl bg-surface-container-lowest hover:bg-surface-container transition-colors text-left group"
                  >
                    <div className="flex items-start gap-3">
                      <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary transition-colors">
                        {topic.icon}
                      </span>
                      <div>
                        <h3 className="font-bold text-sm text-on-surface mb-0.5">{topic.title}</h3>
                        <p className="text-xs text-on-surface-variant">{topic.question}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-xs font-bold text-on-surface-variant uppercase tracking-[0.2em] mb-4">
                Popular Questions
              </h2>
              <ul className="space-y-1">
                {communityInquiries.map((q) => (
                  <li key={q}>
                    <button
                      type="button"
                      onClick={() => handleSuggestionClick(q)}
                      className="w-full text-left flex items-center gap-3 p-3 rounded-md hover:bg-surface-container-high transition-all group"
                    >
                      <span className="material-symbols-outlined text-sm text-primary/40 group-hover:text-primary">
                        lightbulb
                      </span>
                      <span className="text-sm text-on-surface">{q}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <p className="text-[10px] text-on-surface-variant text-center pt-6">
              Conversations clear when you close this tab.{" "}
              <Link to="/privacy" className="underline hover:text-on-surface-variant">Privacy Policy</Link>
            </p>
          </>
        ) : (
          <>
            {messages.map((msg, i) => (
              <div key={msg.timestamp + "-" + i}>
                <ChatMessage message={msg} />
                {msg.role === "assistant" && msg.suggestions && msg.suggestions.length > 0 && i === messages.length - 1 && (
                  <SuggestionChips suggestions={msg.suggestions} onSelect={handleSuggestionClick} />
                )}
              </div>
            ))}
            {isLoading && <ThinkingIndicator status={error} />}
            {error && !isLoading && (
              <div className="flex justify-start mb-4">
                <div role="alert" className="bg-error-container text-on-error-container rounded-xl px-4 py-3 text-sm max-w-[85%] flex items-center gap-3">
                  <span>{error}</span>
                  <button
                    type="button"
                    onClick={retry}
                    className="bg-error text-on-error px-3 py-1 rounded-md text-xs font-medium hover:opacity-90 transition-opacity whitespace-nowrap"
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* STICKY FOOTER */}
      <div className="flex-none px-3 md:px-6 pt-1.5 pb-1.5 md:pt-2 md:pb-3 border-t border-outline-variant bg-surface">
        <div className="relative flex items-end bg-surface-container-high rounded-xl p-1 md:p-2 group transition-all duration-300 focus-within:ring-2 focus-within:ring-primary/20">
          <span className="material-symbols-outlined ml-2 md:ml-3 mb-2 text-on-surface-variant text-[20px] md:text-[24px]">
            auto_awesome
          </span>
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            className="w-full bg-transparent border-none resize-none overflow-hidden px-2 md:px-3 py-2 md:py-2.5 text-on-surface placeholder:text-outline font-body text-base md:text-sm"
            placeholder="Ask about crash data..."
            aria-label="Ask a question about California crash data"
            disabled={isLoading}
            maxLength={500}
            rows={1}
          />
          {inputValue.length > 400 && (
            <span className="text-[10px] text-on-surface-variant mr-2">{inputValue.length}/500</span>
          )}
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputValue.trim() || isLoading || cooldownRemaining > 0}
            className="bg-primary text-on-primary px-3 py-2 md:px-4 md:py-2.5 rounded-lg flex items-center gap-1 md:gap-1.5 hover:opacity-95 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-sm"
          >
            {cooldownRemaining > 0 ? (
              <span>{cooldownRemaining}s</span>
            ) : (
              <>
                <span className="hidden md:inline font-medium">Send</span>
                <span className="material-symbols-outlined text-sm">send</span>
              </>
            )}
          </button>
        </div>
        <div className="hidden md:flex items-center justify-between mt-2 px-2">
          <p className="text-[10px] text-on-surface-variant">
            Your questions are processed by third-party AI providers.{" "}
            <Link to="/privacy" className="underline hover:text-on-surface-variant">Privacy Policy</Link>
          </p>
          <p className="text-[10px] text-on-surface-variant italic">
            AI can hallucinate — verify critical data.
          </p>
        </div>
      </div>
    </div>
  );
}

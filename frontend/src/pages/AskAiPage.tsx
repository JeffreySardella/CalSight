import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAskAi } from "../hooks/useAskAi";
import { useFilterParams } from "../hooks/useFilterParams";
import ChatMessage from "../components/ask/ChatMessage";
import SuggestionChips from "../components/ask/SuggestionChips";
import ThinkingIndicator from "../components/ask/ThinkingIndicator";

const guidedTopics = [
  { icon: "schedule", title: "Temporal Trends", question: "Which day of the week has the most crashes statewide?" },
  { icon: "local_bar", title: "DUI Analysis", question: "How does Kern County's DUI rate compare to the state average?" },
  { icon: "trending_up", title: "Year-over-Year", question: "How have fatal crashes trended in Los Angeles since 2016?" },
  { icon: "pedal_bike", title: "Vulnerable Road Users", question: "Which county has the highest pedestrian fatality rate?" },
] as const;

const communityInquiries = [
  "Compare DUI crash rates between LA, Orange, and San Diego counties",
  "What time of day do most fatal crashes happen statewide?",
  "How did COVID affect crash rates statewide?",
  "Which counties have the worst hit-and-run rates?",
  "What's the relationship between poverty rate and crash fatalities?",
] as const;

export default function AskAiPage() {
  const [inputValue, setInputValue] = useState("");
  const { messages, isLoading, error, cooldownEnd, sendMessage, retry, clearConversation } = useAskAi();
  const { selectedCounties, selectedYears, selectedSeverities, selectedCauses, selectedAlcohol, selectedDistracted } = useFilterParams();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  const hasMessages = messages.length > 0;

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

  const handleSend = () => {
    if (!inputValue.trim() || isLoading || cooldownRemaining > 0) return;
    sendMessage(inputValue);
    setInputValue("");
  };

  const handleSuggestionClick = (question: string) => {
    setInputValue(question);
    inputRef.current?.focus();
  };

  const filterSummary = (() => {
    const parts: string[] = [];
    if (selectedCounties.size > 0) parts.push([...selectedCounties].join(", "));
    if (selectedYears.size > 0) {
      const years = [...selectedYears].sort();
      parts.push(years.length > 3 ? `${years[0]}-${years[years.length - 1]}` : years.join(", "));
    }
    if (selectedSeverities.size > 0) parts.push([...selectedSeverities].join(", "));
    if (selectedCauses.size > 0) parts.push([...selectedCauses].join(", "));
    if (selectedAlcohol) parts.push("Alcohol involved");
    if (selectedDistracted) parts.push("Distraction involved");
    return parts.length > 0 ? parts.join(" | ") : "All California data";
  })();

  return (
    <div className="max-w-[840px] mx-auto px-4 md:px-6 pt-8 pb-4 min-h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-headline text-2xl font-extrabold tracking-tighter text-on-surface">
            Ask AI
          </h1>
          <p className="text-xs text-on-surface-variant">
            Answering with: {filterSummary}
          </p>
        </div>
        {hasMessages && (
          <button
            type="button"
            onClick={clearConversation}
            className="text-xs text-on-surface-variant hover:text-on-surface flex items-center gap-1 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">delete</span>
            Clear
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto mb-4" role="log" aria-label="AI conversation">
        {!hasMessages ? (
          <>
            <section className="mb-8">
              <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-[0.2em] mb-4">
                Explore Topics
              </h3>
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
                        <h4 className="font-bold text-sm text-on-surface mb-0.5">{topic.title}</h4>
                        <p className="text-xs text-on-surface-variant">{topic.question}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-[0.2em] mb-4">
                Popular Questions
              </h3>
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
            {isLoading && <ThinkingIndicator />}
            {error && (
              <div className="flex justify-start mb-4">
                <div className="bg-error-container text-on-error-container rounded-xl px-4 py-3 text-sm max-w-[85%] flex items-center gap-3">
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

      <div className="sticky bottom-0 pb-2">
        <div className="relative flex items-center bg-surface-container-high rounded-xl p-2 group transition-all duration-300 focus-within:ring-2 focus-within:ring-primary/20">
          <span className="material-symbols-outlined ml-3 text-on-surface-variant">
            auto_awesome
          </span>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            className="w-full bg-transparent border-none focus:ring-0 px-3 py-2.5 text-on-surface placeholder:text-outline font-body text-sm"
            placeholder="Ask about California crash data..."
            aria-label="Ask a question about California crash data"
            disabled={isLoading}
            maxLength={500}
          />
          {inputValue.length > 400 && (
            <span className="text-[10px] text-on-surface-variant mr-2">{inputValue.length}/500</span>
          )}
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputValue.trim() || isLoading || cooldownRemaining > 0}
            className="bg-primary text-on-primary px-4 py-2.5 rounded-lg flex items-center gap-1.5 hover:opacity-95 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-sm"
          >
            {cooldownRemaining > 0 ? (
              <span>{cooldownRemaining}s</span>
            ) : (
              <>
                <span className="font-medium">Send</span>
                <span className="material-symbols-outlined text-sm">send</span>
              </>
            )}
          </button>
        </div>
        <div className="flex items-center justify-between mt-2 px-2">
          <p className="text-[10px] text-on-surface-variant/50">
            Your questions are processed by third-party AI providers.{" "}
            <Link to="/privacy" className="underline hover:text-on-surface-variant">Privacy Policy</Link>
          </p>
          <p className="text-[10px] text-on-surface-variant/50 italic">
            AI can hallucinate — verify critical data.
          </p>
        </div>
      </div>
    </div>
  );
}

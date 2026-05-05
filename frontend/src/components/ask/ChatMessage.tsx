import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage as ChatMessageType } from "../../hooks/useAskAi";
import InlineChart from "./InlineChart";

interface Props {
  message: ChatMessageType;
}

const FEEDBACK_KEY = "calsight-ask-ai-feedback";

function saveFeedback(message: ChatMessageType, vote: "up" | "down") {
  try {
    const raw = sessionStorage.getItem(FEEDBACK_KEY);
    const data: Record<string, string> = raw ? JSON.parse(raw) : {};
    data[String(message.timestamp)] = vote;
    sessionStorage.setItem(FEEDBACK_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
  fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: message.question || "",
      answer: message.content,
      provider: message.provider || "",
      tools_called: message.toolsCalled || [],
      vote,
      filters_used: {},
    }),
  }).catch(() => {});
}

function getSavedFeedback(timestamp: number): "up" | "down" | null {
  try {
    const raw = sessionStorage.getItem(FEEDBACK_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data[String(timestamp)] || null;
  } catch { return null; }
}

export default function ChatMessage({ message }: Props) {
  const isUser = message.role === "user";
  const [feedback, setFeedback] = useState<"up" | "down" | null>(
    !isUser ? getSavedFeedback(message.timestamp) : null
  );

  const handleFeedback = (vote: "up" | "down") => {
    const newVote = feedback === vote ? null : vote;
    setFeedback(newVote);
    if (newVote) {
      saveFeedback(message, newVote);
    }
  };

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}
      role="article"
      aria-label={isUser ? `You said: ${message.content}` : "AI response"}
    >
      <div
        className={`rounded-xl px-3 py-3 md:px-4 ${
          isUser
            ? "max-w-[85%] md:max-w-[70%] bg-primary text-on-primary"
            : `${message.chart ? "w-full" : "max-w-[90%] md:max-w-[70%]"} bg-surface-container-lowest ghost-border`
        }`}
      >
        {isUser ? (
          <p className="text-sm">{message.content}</p>
        ) : (
          <>
            <div className="prose prose-sm dark:prose-invert max-w-none text-on-surface">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
            {message.chart && <InlineChart chart={message.chart} />}
          </>
        )}
        {!isUser && message.provider && (
          <div className="flex items-center gap-2 mt-2">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => handleFeedback("up")}
                className={`p-1 rounded transition-colors ${feedback === "up" ? "text-primary" : "text-on-surface-variant/30 hover:text-on-surface-variant/60"}`}
                aria-label="Helpful response"
              >
                <span className="material-symbols-outlined text-sm" style={feedback === "up" ? { fontVariationSettings: "'FILL' 1" } : undefined}>thumb_up</span>
              </button>
              <button
                type="button"
                onClick={() => handleFeedback("down")}
                className={`p-1 rounded transition-colors ${feedback === "down" ? "text-error" : "text-on-surface-variant/30 hover:text-on-surface-variant/60"}`}
                aria-label="Unhelpful response"
              >
                <span className="material-symbols-outlined text-sm" style={feedback === "down" ? { fontVariationSettings: "'FILL' 1" } : undefined}>thumb_down</span>
              </button>
            </div>
            <p className="text-[10px] text-on-surface-variant/50">
              {message.grounded ? (
                <span className="mr-2 text-primary/70">Sourced from CalSight DB</span>
              ) : (
                <span className="mr-2 text-error/70">Not verified against database</span>
              )}
              Powered by {message.provider}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

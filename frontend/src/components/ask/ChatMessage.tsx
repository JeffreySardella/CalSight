import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage as ChatMessageType } from "../../hooks/useAskAi";
import { API_BASE } from "../../config";
import InlineChart from "./InlineChart";
import { useStoryCanvas } from "../../hooks/useStoryCanvas";
import { useToast } from "../ui/toastContext";
import { copyText } from "../../lib/clipboard";

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
  fetch(`${API_BASE}/api/feedback`, {
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

// memo: the Ask AI page re-renders on every keystroke; without this every
// message in the transcript re-renders its markdown (and chart) each tick.
// Message objects are stable references in the messages array, so a shallow
// prop compare bails out for all but genuinely new/changed messages (M-F6).
export default memo(function ChatMessage({ message }: Props) {
  const isUser = message.role === "user";
  const [feedback, setFeedback] = useState<"up" | "down" | null>(
    !isUser ? getSavedFeedback(message.timestamp) : null
  );
  const { pinAnswer, isPinned } = useStoryCanvas();
  const pinned = !isUser && isPinned(message.timestamp);
  const { showToast } = useToast();

  const handleCopy = async () => {
    const ok = await copyText(message.content);
    showToast(
      ok ? "Answer copied to clipboard" : "Couldn't copy to clipboard",
      { variant: ok ? "success" : "error" },
    );
  };

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
                className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors ${feedback === "up" ? "text-primary" : "text-on-surface-variant hover:text-on-surface"}`}
                aria-label="Helpful response"
              >
                <span className="material-symbols-outlined text-sm" style={feedback === "up" ? { fontVariationSettings: "'FILL' 1" } : undefined}>thumb_up</span>
              </button>
              <button
                type="button"
                onClick={() => handleFeedback("down")}
                className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors ${feedback === "down" ? "text-error" : "text-on-surface-variant hover:text-on-surface"}`}
                aria-label="Unhelpful response"
              >
                <span className="material-symbols-outlined text-sm" style={feedback === "down" ? { fontVariationSettings: "'FILL' 1" } : undefined}>thumb_down</span>
              </button>
            </div>
            <button
              type="button"
              onClick={() => pinAnswer(message)}
              aria-label={pinned ? "Pinned to story" : "Pin to story"}
              aria-pressed={pinned}
              className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors ${pinned ? "text-primary" : "text-on-surface-variant hover:text-on-surface"}`}
            >
              <span
                className="material-symbols-outlined text-sm"
                style={pinned ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                push_pin
              </span>
            </button>
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy answer"
              title="Copy answer to clipboard"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition-colors text-on-surface-variant hover:text-on-surface"
            >
              <span className="material-symbols-outlined text-sm">content_copy</span>
            </button>
            <p className="text-[10px] text-on-surface-variant">
              {message.grounded ? (
                <span className="mr-2 text-primary/70">Sourced from CalSight DB</span>
              ) : (
                <span className="mr-2 text-error/70">Not verified against database</span>
              )}
              Powered by {message.provider}
              {message.cached && (
                <span className="ml-2 text-on-surface-variant" title="Reused from response cache â€” no LLM call">(cached)</span>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
});

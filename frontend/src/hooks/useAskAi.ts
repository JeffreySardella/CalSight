import { useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

const STORAGE_KEY = "calsight-ask-ai-messages";
const MAX_MESSAGES = 50;
const COOLDOWN_MS = 15_000;
const API_URL = "/api/ask";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

export interface ChartData {
  type: "bar" | "line" | "pie";
  title?: string;
  xKey?: string;
  yKey?: string;
  data: { label: string; value: number }[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  provider?: string;
  suggestions?: string[];
  chart?: ChartData;
  toolsCalled?: string[];
  grounded?: boolean;
  question?: string;
}

interface AskResponse {
  answer: string;
  provider: string;
  suggestions: string[];
  chart: ChartData | null;
  grounded: boolean;
  filters_used: Record<string, unknown>;
  tools_called: string[];
}

function loadMessages(): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_MESSAGES) : [];
  } catch {
    return [];
  }
}

function saveMessages(messages: ChatMessage[]) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)));
}

export function useAskAi() {
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownEnd, setCooldownEnd] = useState<number>(0);
  const [searchParams] = useSearchParams();

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  const sendMessage = useCallback(async (question: string) => {
    if (!question.trim() || isLoading) return;

    setError(null);
    const userMsg: ChatMessage = {
      role: "user",
      content: question.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    setCooldownEnd(Date.now() + COOLDOWN_MS);

    const history = messagesRef.current.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const filters: Record<string, string | null> = {};
    for (const key of ["year", "severity", "county", "cause", "alcohol", "distracted"]) {
      filters[key] = searchParams.get(key);
    }

    const body = JSON.stringify({ question: question.trim(), filters, history });

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          setError(`Retrying... (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }

        const resp = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });

        if (resp.status === 503) {
          if (attempt < MAX_RETRIES - 1) continue;
          const data = await resp.json().catch(() => ({}));
          const retryAfter = data.retry_after || 60;
          setCooldownEnd(Date.now() + retryAfter * 1000);
          setError(data.message || "All AI providers are busy. Try again shortly.");
          setIsLoading(false);
          return;
        }

        if (resp.status === 429) {
          const data = await resp.json().catch(() => ({}));
          const retryAfter = data.retry_after || 60;
          if (attempt < MAX_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, retryAfter * 1000));
            continue;
          }
          setCooldownEnd(Date.now() + retryAfter * 1000);
          setError(`Rate limit reached. Try again in ${retryAfter} seconds.`);
          setIsLoading(false);
          return;
        }

        if (!resp.ok) {
          if (attempt < MAX_RETRIES - 1) continue;
          setError("Something went wrong. Please try again.");
          setIsLoading(false);
          return;
        }

        const data: AskResponse = await resp.json();
        if (!data.answer || data.answer.trim() === "") {
          if (attempt < MAX_RETRIES - 1) continue;
          setError("AI couldn't generate a response. Try rephrasing your question.");
          setIsLoading(false);
          return;
        }

        setError(null);
        const aiMsg: ChatMessage = {
          role: "assistant",
          content: data.answer,
          timestamp: Date.now(),
          provider: data.provider,
          suggestions: data.suggestions,
          chart: data.chart ?? undefined,
          toolsCalled: data.tools_called,
          grounded: data.grounded,
          question: question.trim(),
        };

        setMessages((prev) => [...prev, aiMsg]);
        setIsLoading(false);
        return;
      } catch {
        if (attempt < MAX_RETRIES - 1) continue;
        setError("Couldn't reach the server. Check your connection.");
      }
    }
    setIsLoading(false);
  }, [isLoading, searchParams]);

  const retry = useCallback(() => {
    const lastUserMsg = [...messagesRef.current].reverse().find((m) => m.role === "user");
    if (lastUserMsg) {
      setError(null);
      setMessages((prev) => prev.filter((m) => m !== lastUserMsg));
      sendMessage(lastUserMsg.content);
    }
  }, [sendMessage]);

  const clearConversation = useCallback(() => {
    setMessages([]);
    sessionStorage.removeItem(STORAGE_KEY);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    error,
    cooldownEnd,
    sendMessage,
    retry,
    clearConversation,
  };
}

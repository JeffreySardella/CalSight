import { useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { API_BASE } from "../config";

const STORAGE_KEY = "calsight-ask-ai-messages";
const MAX_MESSAGES = 50;
const COOLDOWN_MS = 15_000;
const API_URL = `${API_BASE}/api/ask`;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;
const COOLDOWN_KEY = "calsight-ask-ai-cooldown";

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
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)));
  } catch {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-10)));
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }
}

export function useAskAi() {
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownEnd, setCooldownEnd] = useState<number>(() => {
    const stored = sessionStorage.getItem(COOLDOWN_KEY);
    return stored ? Number(stored) : 0;
  });
  const [searchParams] = useSearchParams();

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  useEffect(() => {
    if (cooldownEnd > Date.now()) {
      sessionStorage.setItem(COOLDOWN_KEY, String(cooldownEnd));
    } else {
      sessionStorage.removeItem(COOLDOWN_KEY);
    }
  }, [cooldownEnd]);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const sendMessage = useCallback(async (question: string) => {
    if (!question.trim() || isLoading || inFlightRef.current) return;
    inFlightRef.current = true;
    abortRef.current?.abort();

    setError(null);
    const userMsg: ChatMessage = {
      role: "user",
      content: question.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    setCooldownEnd(Date.now() + COOLDOWN_MS);

    const history = [...messagesRef.current, userMsg].slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const filters: Record<string, string | null> = {};
    for (const key of [
      "start", "end", "year", "severity", "county", "cause",
      "alcohol", "distracted", "pedestrian", "cyclist", "drug",
      "driver_age", "weather", "lighting", "collision_type", "road_type", "hit_run",
    ]) {
      filters[key] = searchParams.get(key);
    }

    const body = JSON.stringify({ question: question.trim(), filters, history });

    let lastWas429 = false;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0 && !lastWas429) {
          setError(`Retrying... (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
        lastWas429 = false;

        const controller = new AbortController();
        abortRef.current = controller;
        const timeout = setTimeout(() => controller.abort(), 55_000);
        const resp = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: controller.signal,
        });
        clearTimeout(timeout);

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
          const retryAfter = data.retry_after || 15;
          if (attempt < MAX_RETRIES - 1) {
            lastWas429 = true;
            setError(`Rate limited. Waiting ${retryAfter}s...`);
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
      } catch (e: unknown) {
        if (attempt < MAX_RETRIES - 1) continue;
        const isTimeout = e instanceof DOMException && e.name === "AbortError";
        setError(isTimeout ? "Request timed out. Try a simpler question." : "Couldn't reach the server. Check your connection.");
      }
    }
    setIsLoading(false);
    inFlightRef.current = false;
    abortRef.current = null;
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
    sessionStorage.removeItem(COOLDOWN_KEY);
    setError(null);
    setCooldownEnd(0);
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

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react";
import type { ChartData, ChatMessage } from "./useAskAi";

const STORAGE_KEY = "calsight-story-canvas";

export type CanvasBlock =
  | {
      id: string;
      kind: "answer";
      question: string;
      content: string;
      chart: ChartData | null;
      provider?: string;
      grounded?: boolean;
      sourceTimestamp: number;
    }
  | {
      id: string;
      kind: "note";
      text: string;
    };

export interface StoryCanvasState {
  title: string;
  blocks: CanvasBlock[];
}

export interface StoryCanvasApi extends StoryCanvasState {
  count: number;
  pinAnswer: (message: ChatMessage) => void;
  isPinned: (timestamp: number) => boolean;
  addNote: () => void;
  updateNote: (id: string, text: string) => void;
  setTitle: (title: string) => void;
  moveBlock: (id: string, dir: "up" | "down") => void;
  removeBlock: (id: string) => void;
  clear: () => void;
}

const EMPTY: StoryCanvasState = { title: "", blocks: [] };

function loadState(): StoryCanvasState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.title === "string" && Array.isArray(parsed.blocks)) {
      return { title: parsed.title, blocks: parsed.blocks };
    }
    return EMPTY;
  } catch {
    return EMPTY;
  }
}

function saveState(state: StoryCanvasState) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
}

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `b-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const Ctx = createContext<StoryCanvasApi | null>(null);

export function StoryCanvasProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StoryCanvasState>(loadState);

  useEffect(() => { saveState(state); }, [state]);

  const pinAnswer = useCallback((message: ChatMessage) => {
    setState((prev) => {
      if (prev.blocks.some((b) => b.kind === "answer" && b.sourceTimestamp === message.timestamp)) {
        return prev;
      }
      const block: CanvasBlock = {
        id: newId(),
        kind: "answer",
        question: message.question ?? "",
        content: message.content,
        chart: message.chart ?? null,
        provider: message.provider,
        grounded: message.grounded,
        sourceTimestamp: message.timestamp,
      };
      return { ...prev, blocks: [...prev.blocks, block] };
    });
  }, []);

  const isPinned = useCallback(
    (timestamp: number) =>
      state.blocks.some((b) => b.kind === "answer" && b.sourceTimestamp === timestamp),
    [state.blocks],
  );

  const addNote = useCallback(() => {
    setState((prev) => ({
      ...prev,
      blocks: [...prev.blocks, { id: newId(), kind: "note", text: "" }],
    }));
  }, []);

  const updateNote = useCallback((id: string, text: string) => {
    setState((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => (b.id === id && b.kind === "note" ? { ...b, text } : b)),
    }));
  }, []);

  const setTitle = useCallback((title: string) => {
    setState((prev) => ({ ...prev, title }));
  }, []);

  const moveBlock = useCallback((id: string, dir: "up" | "down") => {
    setState((prev) => {
      const idx = prev.blocks.findIndex((b) => b.id === id);
      if (idx === -1) return prev;
      const target = dir === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= prev.blocks.length) return prev;
      const blocks = [...prev.blocks];
      [blocks[idx], blocks[target]] = [blocks[target], blocks[idx]];
      return { ...prev, blocks };
    });
  }, []);

  const removeBlock = useCallback((id: string) => {
    setState((prev) => ({ ...prev, blocks: prev.blocks.filter((b) => b.id !== id) }));
  }, []);

  const clear = useCallback(() => setState({ title: "", blocks: [] }), []);

  const api = useMemo<StoryCanvasApi>(() => ({
    title: state.title,
    blocks: state.blocks,
    count: state.blocks.length,
    pinAnswer, isPinned, addNote, updateNote, setTitle, moveBlock, removeBlock, clear,
  }), [state, pinAnswer, isPinned, addNote, updateNote, setTitle, moveBlock, removeBlock, clear]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useStoryCanvas(): StoryCanvasApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useStoryCanvas must be used inside <StoryCanvasProvider>");
  return api;
}

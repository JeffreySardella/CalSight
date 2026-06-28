import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { useStoryCanvas } from "../../hooks/useStoryCanvas";
import InlineChart from "./InlineChart";

interface Props {
  open: boolean;
  onClose: () => void;
  onExportPng: () => void;
  onExportPdf: () => void;
}

export default function StoryCanvasPanel({ open, onClose, onExportPng, onExportPdf }: Props) {
  const {
    title, blocks, count, setTitle, addNote, updateNote, moveBlock, removeBlock, clear,
  } = useStoryCanvas();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const handleClear = () => {
    if (count === 0 || window.confirm("Clear this story? This can't be undone.")) clear();
  };

  return (
    <div className="fixed inset-0 z-[1100] flex justify-end" >
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Your AI story"
        tabIndex={-1}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        className="relative w-full max-w-md h-full bg-surface shadow-xl flex flex-col outline-none"
      >
        {/* Header */}
        <div className="flex-none flex items-center gap-2 px-4 py-3 border-b border-outline-variant">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Story title…"
            aria-label="Story title"
            className="flex-1 bg-transparent text-on-surface font-semibold text-base outline-none placeholder:text-outline"
          />
          <button type="button" onClick={onClose} aria-label="Close story panel" className="p-1 text-on-surface-variant hover:text-on-surface">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {count === 0 ? (
            <p className="text-sm text-on-surface-variant text-center py-12">
              Pin answers from the chat to start building a shareable story.
            </p>
          ) : (
            blocks.map((block, i) => (
              <div key={block.id} className="rounded-lg bg-surface-container-lowest ghost-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {block.kind === "answer" ? (
                      <>
                        <div className="prose prose-sm dark:prose-invert max-w-none text-on-surface">
                          <ReactMarkdown>{block.content}</ReactMarkdown>
                        </div>
                        {block.chart && <InlineChart chart={block.chart} />}
                      </>
                    ) : (
                      <textarea
                        value={block.text}
                        onChange={(e) => updateNote(block.id, e.target.value)}
                        placeholder="Write a note…"
                        aria-label="Story note"
                        className="w-full bg-transparent text-sm text-on-surface resize-none outline-none"
                        rows={2}
                      />
                    )}
                  </div>
                  <div className="flex-none flex flex-col gap-0.5">
                    <button type="button" onClick={() => moveBlock(block.id, "up")} disabled={i === 0} aria-label="Move up" className="p-0.5 text-on-surface-variant hover:text-on-surface disabled:opacity-30">
                      <span className="material-symbols-outlined text-base">arrow_upward</span>
                    </button>
                    <button type="button" onClick={() => moveBlock(block.id, "down")} disabled={i === blocks.length - 1} aria-label="Move down" className="p-0.5 text-on-surface-variant hover:text-on-surface disabled:opacity-30">
                      <span className="material-symbols-outlined text-base">arrow_downward</span>
                    </button>
                    <button type="button" onClick={() => removeBlock(block.id)} aria-label="Remove block" className="p-0.5 text-on-surface-variant hover:text-error">
                      <span className="material-symbols-outlined text-base">delete</span>
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
          <button type="button" onClick={addNote} className="w-full text-sm text-primary hover:underline py-2">
            + Add note
          </button>
        </div>

        {/* Footer */}
        <div className="flex-none flex items-center gap-2 px-4 py-3 border-t border-outline-variant">
          <button type="button" onClick={onExportPng} disabled={count === 0} className="flex-1 bg-primary text-on-primary rounded-lg py-2 text-sm font-medium disabled:opacity-40">
            Export PNG
          </button>
          <button type="button" onClick={onExportPdf} disabled={count === 0} className="flex-1 bg-surface-container-high text-on-surface rounded-lg py-2 text-sm font-medium disabled:opacity-40">
            Export PDF
          </button>
          <button type="button" onClick={handleClear} aria-label="Clear story" className="p-2 text-on-surface-variant hover:text-error">
            <span className="material-symbols-outlined">delete_sweep</span>
          </button>
        </div>
      </div>
    </div>
  );
}

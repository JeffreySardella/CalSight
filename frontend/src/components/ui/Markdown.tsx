import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// LLM answers use GitHub-flavored markdown (tables, strikethrough, task
// lists). react-markdown alone is CommonMark, so pipe tables rendered as
// raw text. Every place that renders model output goes through here.

// react-markdown hands each renderer the hast `node`; it must not reach the DOM.
function dom<T extends { node?: unknown }>(props: T): Omit<T, "node"> {
  const rest = { ...props };
  delete rest.node;
  return rest;
}

const components: Components = {
  table: (p) => (
    <div className="overflow-x-auto my-2">
      <table className="w-full text-xs border-collapse" {...dom(p)} />
    </div>
  ),
  th: (p) => (
    <th className="border border-outline-variant/40 px-2 py-1 text-left font-semibold bg-surface-container-low" {...dom(p)} />
  ),
  td: (p) => <td className="border border-outline-variant/40 px-2 py-1 align-top" {...dom(p)} />,
};

export default function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}

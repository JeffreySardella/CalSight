import ReactMarkdown from "react-markdown";
import type { ChatMessage as ChatMessageType } from "../../hooks/useAskAi";

interface Props {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: Props) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}
      role="article"
      aria-label={isUser ? `You said: ${message.content}` : "AI response"}
    >
      <div
        className={`max-w-[85%] md:max-w-[70%] rounded-xl px-4 py-3 ${
          isUser
            ? "bg-primary text-on-primary"
            : "bg-surface-container-lowest ghost-border"
        }`}
      >
        {isUser ? (
          <p className="text-sm">{message.content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none text-on-surface">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
        {!isUser && message.provider && (
          <p className="text-[10px] text-on-surface-variant/50 mt-2">
            Powered by {message.provider}
          </p>
        )}
      </div>
    </div>
  );
}

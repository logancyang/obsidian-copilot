import * as React from "react";
import { cn } from "@/lib/utils";
import { Copy, ClipboardCopy } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
  onCopy?: (message: Message) => void;
  onInsert?: (message: Message) => void;
}

/**
 * Individual chat message bubble for Quick Ask modal.
 * User messages align right, assistant messages align left with action buttons.
 */
export function ChatMessage({ message, isStreaming, onCopy, onInsert }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "tw-group tw-flex tw-flex-col tw-gap-1",
        isUser ? "tw-items-end" : "tw-items-start"
      )}
    >
      {/* Message bubble */}
      <div
        className={cn(
          "tw-max-w-[80%] tw-rounded-lg tw-px-3 tw-py-2 tw-text-sm",
          "tw-whitespace-pre-wrap tw-leading-relaxed",
          isUser ? "tw-bg-interactive-accent tw-text-on-accent" : "tw-bg-secondary tw-text-normal"
        )}
      >
        {message.content}
        {/* Streaming cursor for assistant messages */}
        {!isUser && isStreaming && (
          <span className="tw-ml-0.5 tw-inline-block tw-h-4 tw-w-1.5 tw-animate-pulse tw-rounded-sm tw-bg-interactive-accent tw-align-middle" />
        )}
      </div>

      {/* Action buttons for assistant messages */}
      {!isUser && !isStreaming && (
        <div className="tw-flex tw-items-center tw-gap-1 tw-opacity-0 tw-transition-opacity group-hover:tw-opacity-100">
          <Button
            variant="ghost2"
            size="icon"
            className="tw-size-5 hover:tw-bg-modifier-hover"
            onClick={() => onCopy?.(message)}
            aria-label="Copy message"
          >
            <Copy className="tw-size-3" />
          </Button>
          <Button
            variant="ghost2"
            size="icon"
            className="tw-size-5 hover:tw-bg-modifier-hover"
            onClick={() => onInsert?.(message)}
            aria-label="Insert at cursor"
          >
            <ClipboardCopy className="tw-size-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

export type { Message };

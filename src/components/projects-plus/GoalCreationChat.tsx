import { GoalCreationMessage } from "@/types/projects-plus";
import { stripExtractionBlock } from "@/core/projects-plus/GoalCreationState";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Bot, Send, User } from "lucide-react";
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

interface GoalCreationChatProps {
  /** Conversation messages */
  messages: GoalCreationMessage[];
  /** Whether AI is currently streaming */
  isStreaming: boolean;
  /** Current streaming content (partial response) */
  currentStreamingContent: string;
  /** Callback when user sends a message */
  onSendMessage: (content: string) => void;
  /** Current error message */
  error: string | null;
}

const SUGGESTED_QUESTIONS = [
  "I want to learn something new",
  "I'm working on a project",
  "I want to build a habit",
];

/**
 * GoalCreationChat - Chat interface for goal creation conversation
 */
export default function GoalCreationChat({
  messages,
  isStreaming,
  currentStreamingContent,
  onSendMessage,
  error,
}: GoalCreationChatProps) {
  const [inputValue, setInputValue] = useState("");
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when messages change or streaming updates
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      );
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages, currentStreamingContent]);

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || isStreaming) return;
    onSendMessage(trimmed);
    setInputValue("");
  }, [inputValue, isStreaming, onSendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleSuggestedQuestion = useCallback(
    (question: string) => {
      if (isStreaming) return;
      onSendMessage(question);
    },
    [isStreaming, onSendMessage]
  );

  // Show suggested questions only when there's just the initial AI greeting
  const showSuggestions = messages.length === 1 && messages[0].role === "assistant";

  return (
    <div className="tw-flex tw-flex-1 tw-flex-col tw-overflow-hidden">
      {/* Messages area */}
      <ScrollArea ref={scrollAreaRef} className="tw-flex-1">
        <div className="tw-flex tw-flex-col tw-gap-3 tw-p-3">
          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}

          {/* Streaming message */}
          {isStreaming && currentStreamingContent && (
            <div className="tw-flex tw-gap-2">
              <div className="tw-flex tw-size-6 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-bg-interactive-accent">
                <Bot className="tw-size-3.5 tw-text-on-accent" />
              </div>
              <div className="tw-flex-1 tw-text-sm tw-text-normal">
                <div className="tw-whitespace-pre-wrap">
                  {stripExtractionBlock(currentStreamingContent)}
                </div>
                <span className="tw-inline-block tw-animate-pulse tw-text-muted">...</span>
              </div>
            </div>
          )}

          {/* Streaming indicator when no content yet */}
          {isStreaming && !currentStreamingContent && (
            <div className="tw-flex tw-gap-2">
              <div className="tw-flex tw-size-6 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-bg-interactive-accent">
                <Bot className="tw-size-3.5 tw-text-on-accent" />
              </div>
              <div className="tw-flex tw-items-center tw-gap-1 tw-text-sm tw-text-muted">
                <span className="tw-animate-pulse">Thinking</span>
                <span className="tw-animate-pulse">...</span>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="tw-rounded tw-bg-modifier-error-rgb/20 tw-p-2 tw-text-sm tw-text-error">
              {error}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Suggested questions */}
      {showSuggestions && !isStreaming && (
        <div className="tw-border-t tw-border-border tw-p-3">
          <p className="tw-mb-2 tw-text-xs tw-text-muted">Suggestions:</p>
          <div className="tw-flex tw-flex-wrap tw-gap-2">
            {SUGGESTED_QUESTIONS.map((question) => (
              <button
                key={question}
                onClick={() => handleSuggestedQuestion(question)}
                className="tw-rounded-full tw-border tw-border-border tw-bg-primary tw-px-3 tw-py-1 tw-text-xs tw-text-normal tw-transition-colors hover:tw-bg-interactive-hover"
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="tw-border-t tw-border-border tw-p-3">
        <div className="tw-flex tw-gap-2">
          <Textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your goal..."
            disabled={isStreaming}
            rows={1}
            className="tw-max-h-32 tw-min-h-10 tw-resize-none"
          />
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!inputValue.trim() || isStreaming}
            className="tw-shrink-0"
          >
            <Send className="tw-size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Individual chat message component
 */
function ChatMessage({ message }: { message: GoalCreationMessage }) {
  const isUser = message.role === "user";
  const displayContent = stripExtractionBlock(message.content);

  return (
    <div className={cn("tw-flex tw-gap-2", isUser && "tw-flex-row-reverse")}>
      <div
        className={cn(
          "tw-flex tw-size-6 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full",
          isUser ? "tw-bg-secondary" : "tw-bg-interactive-accent"
        )}
      >
        {isUser ? (
          <User className="tw-size-3.5 tw-text-muted" />
        ) : (
          <Bot className="tw-size-3.5 tw-text-on-accent" />
        )}
      </div>
      <div
        className={cn(
          "tw-max-w-[85%] tw-rounded-lg tw-px-3 tw-py-2 tw-text-sm",
          isUser ? "tw-bg-interactive-accent tw-text-on-accent" : "tw-bg-secondary tw-text-normal"
        )}
      >
        <div className="tw-whitespace-pre-wrap">{displayContent}</div>
      </div>
    </div>
  );
}

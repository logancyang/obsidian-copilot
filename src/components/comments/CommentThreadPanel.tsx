/**
 * CommentThreadPanel - the React UI for an inline comment thread.
 *
 * Phase B: wires the streaming chat session. Shows streaming AI text as a
 * transient bubble, persists completed messages to CommentStore via the hook.
 */

import React, { useEffect, useRef, useState } from "react";
import { Check, CornerDownLeft, RotateCcw, Square, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { commentStore } from "@/comments/CommentStore";
import type { Comment } from "@/comments/types";
import { cn } from "@/lib/utils";
import { useCommentThreadSession } from "./useCommentThreadSession";
import { SuggestedEditCard } from "./SuggestedEditCard";
import type { CommentThreadPanelOptions } from "./types";

export function CommentThreadPanel(props: CommentThreadPanelOptions) {
  const {
    notePath,
    commentId,
    initialComment,
    sessionManager,
    onClose,
    onResolveToggle,
    onDelete,
    onReviewSuggestedEdit,
  } = props;
  const [comment, setComment] = useState<Comment>(initialComment);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { isStreaming, streamingText, sendMessage, stop } = useCommentThreadSession({
    sessionManager,
    notePath,
    commentId,
  });

  useEffect(() => {
    const unsubscribe = commentStore.subscribe((path) => {
      if (path !== notePath) return;
      const next = commentStore.getComment(notePath, commentId);
      if (next) setComment(next);
    });
    return unsubscribe;
  }, [notePath, commentId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [comment.messages.length, streamingText]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    void sendMessage(text);
  };

  const isResolved = comment.state === "resolved";
  const isOrphaned = comment.state === "orphaned";
  const canType = !isResolved;

  return (
    <div
      className={cn(
        "tw-flex tw-flex-col tw-overflow-hidden tw-rounded-lg tw-border tw-border-border",
        "tw-bg-primary tw-shadow-lg"
      )}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-border-b tw-border-border tw-px-3 tw-py-2">
        <div className="tw-flex tw-items-center tw-gap-2">
          <span className="tw-text-xs tw-font-medium tw-text-muted">Copilot comment</span>
          {isResolved && (
            <span className="tw-rounded tw-bg-success tw-px-1.5 tw-py-0.5 tw-text-xs tw-text-success">
              Resolved
            </span>
          )}
          {isOrphaned && (
            <span className="tw-rounded tw-bg-error tw-px-1.5 tw-py-0.5 tw-text-xs tw-text-error">
              Orphaned
            </span>
          )}
          {isStreaming && (
            <span className="tw-flex tw-items-center tw-gap-1.5 tw-rounded tw-bg-secondary tw-px-1.5 tw-py-0.5 tw-text-xs tw-text-loading">
              <span className="copilot-comment-streaming-dot" />
              Streaming
            </span>
          )}
        </div>
        <div className="tw-flex tw-items-center tw-gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onResolveToggle}
            title={isResolved ? "Reopen" : "Resolve"}
          >
            {isResolved ? <RotateCcw className="tw-size-4" /> : <Check className="tw-size-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} title="Delete">
            <Trash2 className="tw-size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} title="Close">
            <X className="tw-size-4" />
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="tw-flex tw-flex-col tw-gap-2 tw-overflow-y-auto tw-px-3 tw-py-2"
        style={{ maxHeight: "48vh" }}
      >
        <div className="tw-rounded tw-border tw-border-border tw-bg-secondary tw-px-2 tw-py-1 tw-text-xs tw-text-muted">
          <span className="tw-font-medium">On:</span> “{truncate(comment.anchor.exactText, 140)}”
        </div>
        {comment.messages.length === 0 && !isStreaming && (
          <div className="tw-text-xs tw-text-faint">
            Leave a comment or ask a question about this passage.
          </div>
        )}
        {comment.messages.map((m) => (
          <React.Fragment key={m.id}>
            {m.content && <MessageBubble role={m.role} content={m.content} />}
            {m.suggestedEdit && (
              <SuggestedEditCard
                edit={m.suggestedEdit}
                disabled={isStreaming}
                onReview={() => onReviewSuggestedEdit(m.id)}
              />
            )}
          </React.Fragment>
        ))}
        {isStreaming &&
          (streamingText ? (
            <MessageBubble role="assistant" content={streamingText} streaming />
          ) : (
            <ThinkingBubble />
          ))}
      </div>

      <div className="tw-flex tw-items-end tw-gap-2 tw-border-t tw-border-border tw-p-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder={isResolved ? "Reopen to reply" : "Write a comment…"}
          disabled={!canType}
          rows={2}
          className="tw-w-full tw-resize-none tw-rounded tw-border tw-border-border tw-bg-primary tw-px-2 tw-py-1 tw-text-sm focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-ring disabled:tw-opacity-50"
        />
        {isStreaming ? (
          <Button size="icon" onClick={() => stop()} title="Stop" variant="destructive">
            <Square className="tw-size-4" />
          </Button>
        ) : (
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!canType || input.trim().length === 0}
            title="Send (Enter)"
          >
            <CornerDownLeft className="tw-size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div
      className={cn(
        "tw-flex tw-items-center tw-gap-1.5 tw-self-start tw-rounded-md tw-bg-secondary-alt tw-px-2 tw-py-1.5 tw-text-sm tw-text-muted"
      )}
      aria-live="polite"
    >
      <span className="copilot-comment-thinking-dot tw-bg-muted tw-size-1.5 tw-rounded-full" />
      <span className="copilot-comment-thinking-dot tw-bg-muted tw-size-1.5 tw-rounded-full" />
      <span className="copilot-comment-thinking-dot tw-bg-muted tw-size-1.5 tw-rounded-full" />
      <span className="tw-ml-1 tw-text-xs">Thinking…</span>
    </div>
  );
}

function MessageBubble({
  role,
  content,
  streaming = false,
}: {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}) {
  return (
    <div
      className={cn(
        "tw-whitespace-pre-wrap tw-rounded-md tw-px-2 tw-py-1.5 tw-text-sm",
        role === "user"
          ? "tw-self-end tw-bg-interactive-accent tw-text-on-accent"
          : "tw-self-start tw-bg-secondary-alt tw-text-normal",
        streaming && "tw-opacity-90"
      )}
    >
      {content}
      {streaming && <span className="tw-animate-pulse">▍</span>}
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

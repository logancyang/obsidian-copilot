/**
 * QuickAskMessage - Renders individual messages in Quick Ask panel.
 * Handles markdown rendering for assistant messages.
 */

import React, { useEffect, useRef } from "react";
import { MarkdownRenderer } from "obsidian";
import { Copy, ClipboardPaste, Replace } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getErrorMessage, type ReplaceInvalidReason } from "@/editor/replaceGuard";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import type { QuickAskMessage } from "./types";

interface QuickAskMessageProps {
  message: QuickAskMessage;
  isStreaming: boolean;
  isLastAssistantMessage: boolean;
  onCopy: (messageId: string) => void;
  onInsert: (messageId: string) => void;
  onReplace: (messageId: string) => void;
  hasSelection: boolean;
  isReplaceValid: boolean;
  replaceInvalidReason: ReplaceInvalidReason | null;
  /** Whether Replace is disabled because streaming is in progress */
  isDisabledDueToStreaming?: boolean;
  /** File path captured when panel opened; used for stable Markdown link resolution */
  filePathSnapshot: string | null;
  plugin: CopilotPlugin;
}

/**
 * Component for rendering a single Quick Ask message.
 * Renders markdown for completed assistant messages.
 */
export const QuickAskMessageComponent = React.memo(function QuickAskMessageComponent({
  message,
  isStreaming,
  isLastAssistantMessage,
  onCopy,
  onInsert,
  onReplace,
  hasSelection,
  isReplaceValid,
  replaceInvalidReason,
  isDisabledDueToStreaming,
  filePathSnapshot,
  plugin,
}: QuickAskMessageProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Render markdown for completed assistant messages
  useEffect(() => {
    if (message.role !== "assistant" || isStreaming) return;

    let cancelled = false;

    /**
     * Renders markdown directly into the target element if still mounted.
     */
    const renderMarkdown = async (): Promise<void> => {
      const targetEl = contentRef.current;
      if (!targetEl) return;

      targetEl.empty();
      const sourcePath = filePathSnapshot ?? "";

      try {
        await MarkdownRenderer.renderMarkdown(message.content, targetEl, sourcePath, plugin);
      } catch (error) {
        logError("Failed to render markdown:", error);

        if (cancelled) return;

        // Fallback to plain text if markdown rendering fails
        targetEl.empty();
        targetEl.textContent = message.content;
      }

      if (cancelled) return;

      targetEl.classList.add("markdown-rendered");
    };

    void renderMarkdown();

    return () => {
      cancelled = true;
    };
  }, [message.content, message.role, isStreaming, filePathSnapshot, plugin]);

  // User message - right aligned with accent background (like YOLO)
  if (message.role === "user") {
    return (
      <div className="tw-max-w-[85%] tw-self-end tw-rounded-lg tw-rounded-br-sm tw-bg-interactive-accent tw-px-3 tw-py-2 tw-text-on-accent">
        <div className="tw-whitespace-pre-wrap tw-break-words tw-text-sm">{message.content}</div>
      </div>
    );
  }

  // Assistant message - streaming (left aligned)
  if (isStreaming) {
    return (
      <div className="tw-max-w-[95%] tw-self-start tw-rounded-lg tw-rounded-bl-sm tw-bg-secondary tw-px-3 tw-py-2">
        <div className="tw-whitespace-pre-wrap tw-break-words tw-text-sm tw-text-normal">
          {message.content}
          <span className="tw-animate-pulse tw-text-accent">▊</span>
        </div>
      </div>
    );
  }

  // Assistant message - completed with markdown + action buttons (left aligned)
  // Last assistant message shows action buttons by default, others show on hover
  const actionBarVisibility = isLastAssistantMessage
    ? "tw-opacity-100"
    : "tw-opacity-0 group-hover/message:tw-opacity-100";

  return (
    <div className="tw-group/message tw-max-w-[95%] tw-self-start">
      <div className="tw-rounded-lg tw-rounded-bl-sm tw-bg-secondary tw-px-3 tw-py-2">
        <div
          ref={contentRef}
          className="tw-text-sm [&.markdown-rendered]:tw-text-sm [&_code]:tw-text-xs [&_p]:tw-my-1 [&_pre]:tw-my-2"
        />
      </div>
      {message.content && (
        <div
          className={`tw-mt-1 tw-flex tw-items-center tw-gap-0.5 tw-transition-opacity ${actionBarVisibility}`}
        >
          <Button
            variant="ghost2"
            size="icon"
            className="tw-size-5 hover:tw-bg-modifier-hover"
            onClick={() => onCopy(message.id)}
            title="Copy to clipboard"
          >
            <Copy className="tw-size-3" />
          </Button>
          <Button
            variant="ghost2"
            size="icon"
            className="tw-size-5 hover:tw-bg-modifier-hover"
            onClick={() => onInsert(message.id)}
            title="Insert at cursor"
          >
            <ClipboardPaste className="tw-size-3" />
          </Button>
          {hasSelection && (
            <Button
              variant="ghost2"
              size="icon"
              className="tw-size-5 hover:tw-bg-modifier-hover"
              onClick={() => onReplace(message.id)}
              disabled={!isReplaceValid}
              title={
                isDisabledDueToStreaming
                  ? "Stop generating to replace"
                  : !isReplaceValid
                    ? getErrorMessage(replaceInvalidReason)
                    : "Replace selection"
              }
            >
              <Replace className="tw-size-3" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
});

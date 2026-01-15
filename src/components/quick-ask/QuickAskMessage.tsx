/**
 * QuickAskMessage - Renders individual messages in Quick Ask panel.
 * Handles markdown rendering for assistant messages.
 */

import React, { useEffect, useRef } from "react";
import { MarkdownRenderer } from "obsidian";
import { Copy, CornerDownLeft, Replace } from "lucide-react";
import type CopilotPlugin from "@/main";
import type { QuickAskMessage } from "./types";

interface QuickAskMessageProps {
  message: QuickAskMessage;
  isStreaming: boolean;
  onCopy: (messageId: string) => void;
  onInsert: (messageId: string) => void;
  onReplace: (messageId: string) => void;
  hasSelection: boolean;
  isReplaceValid: boolean;
  plugin: CopilotPlugin;
}

/**
 * Component for rendering a single Quick Ask message.
 */
export const QuickAskMessageComponent = React.memo(function QuickAskMessageComponent({
  message,
  isStreaming,
  onCopy,
  onInsert,
  onReplace,
  hasSelection,
  isReplaceValid,
  plugin,
}: QuickAskMessageProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Render markdown for completed assistant messages
  useEffect(() => {
    if (contentRef.current && message.role === "assistant" && !isStreaming) {
      contentRef.current.empty();
      const sourcePath = plugin.app.workspace.getActiveFile()?.path ?? "";
      MarkdownRenderer.renderMarkdown(message.content, contentRef.current, sourcePath, plugin);
    }
  }, [message.content, message.role, isStreaming, plugin]);

  // User message - right aligned with accent background (like YOLO)
  if (message.role === "user") {
    return (
      <div className="tw-max-w-[85%] tw-self-end tw-rounded-lg tw-rounded-br-sm tw-bg-interactive-accent tw-px-3 tw-py-2 tw-text-on-accent">
        <div className="tw-whitespace-pre-wrap tw-break-words tw-text-sm">
          {message.content}
        </div>
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
  return (
    <div className="tw-group tw-relative tw-max-w-[95%] tw-self-start tw-rounded-lg tw-rounded-bl-sm tw-bg-secondary tw-px-3 tw-py-2">
      <div
        ref={contentRef}
        className="tw-text-sm [&_.markdown-rendered]:tw-text-sm [&_code]:tw-text-xs [&_p]:tw-my-1 [&_pre]:tw-my-2"
      />
      {message.content && (
        <div className="tw-absolute tw-bottom-1 tw-right-1 tw-flex tw-items-center tw-gap-0.5 tw-rounded tw-bg-secondary tw-opacity-0 tw-shadow-sm tw-transition-opacity group-hover:tw-opacity-100">
          <button
            className="tw-rounded tw-p-1 tw-text-muted hover:tw-bg-modifier-hover hover:tw-text-normal"
            onClick={() => onCopy(message.id)}
            title="Copy to clipboard"
          >
            <Copy className="tw-size-3.5" />
          </button>
          <button
            className="tw-rounded tw-p-1 tw-text-muted hover:tw-bg-modifier-hover hover:tw-text-normal"
            onClick={() => onInsert(message.id)}
            title="Insert at cursor"
          >
            <CornerDownLeft className="tw-size-3.5" />
          </button>
          {hasSelection && (
            <button
              className="tw-rounded tw-p-1 tw-text-muted hover:tw-bg-modifier-hover hover:tw-text-normal disabled:tw-cursor-not-allowed disabled:tw-opacity-50"
              onClick={() => onReplace(message.id)}
              disabled={!isReplaceValid}
              title={!isReplaceValid ? "Selection has changed" : "Replace selection"}
            >
              <Replace className="tw-size-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
});

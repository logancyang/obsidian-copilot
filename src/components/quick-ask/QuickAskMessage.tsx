/**
 * QuickAskMessage - Renders individual messages in Quick Ask panel.
 * Handles markdown rendering for assistant messages.
 */

import React, { useEffect, useRef } from "react";
import { MarkdownRenderer } from "obsidian";
import { Copy, ClipboardPaste, Replace } from "lucide-react";
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
  plugin: CopilotPlugin;
}

/**
 * Component for rendering a single Quick Ask message.
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
  // Last assistant message shows action buttons by default, others show on hover
  const actionBarVisibility = isLastAssistantMessage
    ? "tw-opacity-100"
    : "tw-opacity-0 group-hover/message:tw-opacity-100";

  return (
    <div className="tw-group/message tw-max-w-[95%] tw-self-start">
      <div className="tw-rounded-lg tw-rounded-bl-sm tw-bg-secondary tw-px-3 tw-py-2">
        <div
          ref={contentRef}
          className="tw-text-sm [&_.markdown-rendered]:tw-text-sm [&_code]:tw-text-xs [&_p]:tw-my-1 [&_pre]:tw-my-2"
        />
      </div>
      {message.content && (
        <div
          className={`tw-mt-1 tw-flex tw-items-center tw-gap-0.5 tw-transition-opacity ${actionBarVisibility}`}
        >
          <button
            className="tw-flex tw-size-5 tw-items-center tw-justify-center tw-rounded tw-p-0 tw-text-muted hover:tw-bg-modifier-hover hover:tw-text-normal"
            onClick={() => onCopy(message.id)}
            title="Copy to clipboard"
          >
            <Copy className="tw-size-3" />
          </button>
          <button
            className="tw-flex tw-size-5 tw-items-center tw-justify-center tw-rounded tw-p-0 tw-text-muted hover:tw-bg-modifier-hover hover:tw-text-normal"
            onClick={() => onInsert(message.id)}
            title="Insert at cursor"
          >
            <ClipboardPaste className="tw-size-3" />
          </button>
          {hasSelection && (
            <button
              className="tw-flex tw-size-5 tw-items-center tw-justify-center tw-rounded tw-p-0 tw-text-muted hover:tw-bg-modifier-hover hover:tw-text-normal disabled:tw-cursor-not-allowed disabled:tw-opacity-50"
              onClick={() => onReplace(message.id)}
              disabled={!isReplaceValid}
              title={!isReplaceValid ? "Selection has changed" : "Replace selection"}
            >
              <Replace className="tw-size-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
});

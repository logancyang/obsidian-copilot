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

  // User message
  if (message.role === "user") {
    return (
      <div className="tw-my-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-modifier-hover tw-p-2">
        <div className="tw-whitespace-pre-wrap tw-break-words tw-text-sm tw-text-normal">
          {message.content}
        </div>
      </div>
    );
  }

  // Assistant message - streaming
  if (isStreaming) {
    return (
      <div className="tw-my-2">
        <div className="tw-whitespace-pre-wrap tw-break-words tw-text-sm tw-text-normal">
          {message.content}
          <span className="tw-animate-pulse tw-text-accent">▊</span>
        </div>
      </div>
    );
  }

  // Assistant message - completed with markdown + action buttons
  return (
    <div className="tw-my-2">
      <div
        ref={contentRef}
        className="tw-text-sm [&_.markdown-rendered]:tw-text-sm [&_code]:tw-text-xs [&_p]:tw-my-1 [&_pre]:tw-my-2"
      />
      {message.content && (
        <div className="tw-mt-2 tw-flex tw-items-center tw-gap-1 tw-border-t tw-border-solid tw-border-border tw-pt-2">
          <button
            className="tw-flex tw-items-center tw-gap-1 tw-rounded tw-px-2 tw-py-1 tw-text-xs tw-text-muted hover:tw-bg-modifier-hover hover:tw-text-normal"
            onClick={() => onCopy(message.id)}
            title="Copy to clipboard"
          >
            <Copy className="tw-size-3" />
            <span>Copy</span>
          </button>
          <button
            className="tw-flex tw-items-center tw-gap-1 tw-rounded tw-px-2 tw-py-1 tw-text-xs tw-text-muted hover:tw-bg-modifier-hover hover:tw-text-normal"
            onClick={() => onInsert(message.id)}
            title="Insert at cursor"
          >
            <CornerDownLeft className="tw-size-3" />
            <span>Insert</span>
          </button>
          <button
            className="tw-flex tw-items-center tw-gap-1 tw-rounded tw-px-2 tw-py-1 tw-text-xs tw-text-muted hover:tw-bg-modifier-hover hover:tw-text-normal disabled:tw-cursor-not-allowed disabled:tw-opacity-50"
            onClick={() => onReplace(message.id)}
            disabled={!hasSelection || !isReplaceValid}
            title={
              !hasSelection
                ? "No text selected"
                : !isReplaceValid
                  ? "Selection has changed"
                  : "Replace selection"
            }
          >
            <Replace className="tw-size-3" />
            <span>Replace</span>
          </button>
        </div>
      )}
    </div>
  );
});

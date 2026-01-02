/**
 * DiscussMessage - Individual message rendering with source attribution
 */

import { USER_SENDER } from "@/constants";
import { cn } from "@/lib/utils";
import { DiscussMessage as DiscussMessageType } from "@/types/discuss";
import { SourceAttribution } from "./SourceAttribution";
import { App, Component, MarkdownRenderer } from "obsidian";
import * as React from "react";
import { useEffect, useRef } from "react";

interface DiscussMessageProps {
  message: DiscussMessageType;
  isStreaming?: boolean;
  onOpenNote: (path: string) => void;
  app: App;
}

/**
 * Component to render markdown content using Obsidian's renderer
 */
function MarkdownContent({
  content,
  app,
  className,
}: {
  content: string;
  app: App;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const componentRef = useRef<Component | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Create a component for the markdown renderer
    componentRef.current = new Component();
    componentRef.current.load();

    // Clear previous content
    containerRef.current.innerHTML = "";

    // Render markdown
    MarkdownRenderer.renderMarkdown(content, containerRef.current, "", componentRef.current);

    return () => {
      componentRef.current?.unload();
    };
  }, [content, app]);

  return <div ref={containerRef} className={className} />;
}

/**
 * Renders a single Discuss message
 */
export function DiscussMessage({
  message,
  isStreaming = false,
  onOpenNote,
  app,
}: DiscussMessageProps) {
  const isUser = message.sender === USER_SENDER;

  return (
    <div
      className={cn(
        "tw-flex tw-w-full tw-flex-col tw-gap-1 tw-py-2",
        isUser ? "tw-items-end" : "tw-items-start"
      )}
    >
      <div
        className={cn(
          "tw-max-w-[85%] tw-rounded tw-px-3 tw-py-2",
          isUser ? "tw-bg-interactive-accent tw-text-on-accent" : "tw-bg-secondary tw-text-normal",
          message.isErrorMessage && "tw-bg-modifier-error-rgb/20 tw-text-error"
        )}
      >
        {isUser ? (
          // User messages render as plain text
          <div className="tw-whitespace-pre-wrap tw-text-sm">{message.message}</div>
        ) : (
          // AI messages render as markdown
          <MarkdownContent content={message.message} app={app} className="tw-text-sm" />
        )}

        {/* Source attribution for AI messages */}
        {!isUser && message.discussSources && message.discussSources.length > 0 && (
          <SourceAttribution sources={message.discussSources} onOpenNote={onOpenNote} />
        )}
      </div>

      {/* Streaming indicator */}
      {isStreaming && !isUser && (
        <span className="tw-text-xs tw-text-muted">
          <span className="tw-inline-block tw-animate-pulse">Thinking...</span>
        </span>
      )}
    </div>
  );
}

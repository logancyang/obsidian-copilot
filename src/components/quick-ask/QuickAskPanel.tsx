/**
 * QuickAskPanel - Main UI component for Quick Ask feature.
 * Provides multi-turn chat interface with Copy/Insert/Replace actions.
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import { Notice } from "obsidian";
import { Send, Square, RotateCcw, X, GripHorizontal } from "lucide-react";
import { useModelKey } from "@/aiParams";
import { useSettingsValue, updateSetting } from "@/settings/model";
import { cleanMessageForCopy, insertIntoEditor } from "@/utils";
import { ModelSelector } from "@/components/ui/ModelSelector";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useQuickAskSession } from "./useQuickAskSession";
import { QuickAskMessageComponent } from "./QuickAskMessage";
import type { QuickAskPanelProps } from "./types";

/**
 * QuickAskPanel - Floating panel for Quick Ask interactions.
 */
export function QuickAskPanel({
  plugin,
  editor,
  view,
  selectedText,
  selectionFrom,
  selectionTo,
  onClose,
  onDragOffset,
  onResize,
}: QuickAskPanelProps) {
  // UI state
  const [inputText, setInputText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Settings
  const settings = useSettingsValue();
  const [globalModelKey] = useModelKey();
  const selectedModelKey = settings.quickCommandModelKey ?? globalModelKey;
  const includeNoteContext = settings.quickCommandIncludeNoteContext;

  // Session hook
  const { messages, isStreaming, sendMessage, stop, clear } = useQuickAskSession({
    selectedText,
    selectedModelKey,
    includeNoteContext,
    settings,
  });

  // Derived state
  const hasMessages = messages.length > 0;
  const hasSelection = selectionFrom !== selectionTo;

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; panelX: number; panelY: number } | null>(
    null
  );

  // Check if selection is still valid for Replace
  const isSelectionValid = useCallback(() => {
    if (!view) return false;
    try {
      const docLength = view.state.doc.length;
      if (
        selectionFrom < 0 ||
        selectionTo > docLength ||
        selectionFrom >= selectionTo
      )
        return false;
      const current = view.state.doc.sliceString(selectionFrom, selectionTo);
      // Normalize line endings for comparison
      const normalize = (text: string) => text.replace(/\r\n/g, "\n");
      return normalize(current) === normalize(selectedText);
    } catch {
      // View might be destroyed or in invalid state
      return false;
    }
  }, [view, selectionFrom, selectionTo, selectedText]);

  // Submit handler
  const handleSubmit = useCallback(async () => {
    if (!inputText.trim() || isStreaming) return;
    await sendMessage(inputText);
    setInputText("");
  }, [inputText, isStreaming, sendMessage]);

  // Keyboard handler
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // IME composition - ignore
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [handleSubmit, onClose]
  );

  // Stop event propagation to prevent CM6 from handling
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const stopPropagation = (e: Event) => e.stopPropagation();

    el.addEventListener("keydown", stopPropagation);
    el.addEventListener("keyup", stopPropagation);
    el.addEventListener("keypress", stopPropagation);
    el.addEventListener("beforeinput", stopPropagation);
    el.addEventListener("input", stopPropagation);

    return () => {
      el.removeEventListener("keydown", stopPropagation);
      el.removeEventListener("keyup", stopPropagation);
      el.removeEventListener("keypress", stopPropagation);
      el.removeEventListener("beforeinput", stopPropagation);
      el.removeEventListener("input", stopPropagation);
    };
  }, []);

  // Auto-focus on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (chatAreaRef.current) {
      chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
    }
  }, [messages]);

  // Action handlers
  const handleCopy = useCallback(
    (messageId: string) => {
      const message = messages.find((m) => m.id === messageId);
      if (message && message.role === "assistant") {
        const cleaned = cleanMessageForCopy(message.content);
        navigator.clipboard.writeText(cleaned);
        new Notice("Copied to clipboard");
      }
    },
    [messages]
  );

  const handleInsert = useCallback(
    (messageId: string) => {
      const message = messages.find((m) => m.id === messageId);
      if (message && message.role === "assistant") {
        insertIntoEditor(message.content, false);
        onClose();
      }
    },
    [messages, onClose]
  );

  const handleReplace = useCallback(
    (messageId: string) => {
      const message = messages.find((m) => m.id === messageId);
      if (!message || message.role !== "assistant") return;

      if (!isSelectionValid()) {
        new Notice("Selection has changed. Please reselect text and reopen the panel.");
        return;
      }

      const cleaned = cleanMessageForCopy(message.content);
      view.dispatch({
        changes: { from: selectionFrom, to: selectionTo, insert: cleaned },
      });
      new Notice("Replaced");
      onClose();
    },
    [messages, isSelectionValid, view, selectionFrom, selectionTo, onClose]
  );

  const handleModelChange = useCallback((modelKey: string) => {
    updateSetting("quickCommandModelKey", modelKey);
  }, []);

  const handleIncludeNoteContextChange = useCallback((checked: boolean) => {
    updateSetting("quickCommandIncludeNoteContext", checked);
  }, []);

  // Drag handling
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panelX: rect.left,
        panelY: rect.top,
      };
      setIsDragging(true);
      e.preventDefault();
    },
    []
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const deltaX = e.clientX - dragStartRef.current.x;
      const deltaY = e.clientY - dragStartRef.current.y;
      const newX = dragStartRef.current.panelX + deltaX;
      const newY = dragStartRef.current.panelY + deltaY;
      onDragOffset?.({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, onDragOffset]);

  return (
    <div
      ref={containerRef}
      className="tw-flex tw-flex-col tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-primary tw-shadow-lg"
      onKeyDown={handleKeyDown}
    >
      {/* Drag handle */}
      <div
        className="tw-flex tw-cursor-grab tw-items-center tw-justify-center tw-border-b tw-border-solid tw-border-border tw-py-1 active:tw-cursor-grabbing"
        onMouseDown={handleDragStart}
      >
        <GripHorizontal className="tw-size-4 tw-text-faint" />
      </div>

      {/* Input area */}
      <div className="tw-relative tw-p-3">
        <Textarea
          ref={textareaRef}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Ask a question..."
          className="tw-min-h-16 tw-resize-none tw-pr-8"
          rows={2}
          disabled={isStreaming}
        />
        <button
          className="tw-absolute tw-right-4 tw-top-4 tw-rounded tw-p-1 tw-text-muted hover:tw-bg-modifier-hover hover:tw-text-normal"
          onClick={onClose}
          title="Close"
        >
          <X className="tw-size-4" />
        </button>
      </div>

      {/* Chat area - only shown when there are messages */}
      {hasMessages && (
        <div
          ref={chatAreaRef}
          className="tw-max-h-64 tw-overflow-y-auto tw-border-t tw-border-solid tw-border-border tw-px-3 tw-py-2"
        >
          {messages.map((msg, idx) => (
            <QuickAskMessageComponent
              key={msg.id}
              message={msg}
              isStreaming={isStreaming && idx === messages.length - 1 && msg.role === "assistant"}
              onCopy={handleCopy}
              onInsert={handleInsert}
              onReplace={handleReplace}
              hasSelection={hasSelection}
              isReplaceValid={isSelectionValid()}
              plugin={plugin}
            />
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-border-t tw-border-solid tw-border-border tw-px-3 tw-py-2">
        <div className="tw-flex tw-items-center tw-gap-3">
          <ModelSelector
            size="sm"
            variant="ghost"
            value={selectedModelKey}
            onChange={handleModelChange}
          />

          <div className="tw-flex tw-items-center tw-gap-2">
            <Checkbox
              id="quickAskIncludeContext"
              checked={includeNoteContext}
              onCheckedChange={(checked) => handleIncludeNoteContextChange(!!checked)}
            />
            <label
              htmlFor="quickAskIncludeContext"
              className="tw-cursor-pointer tw-text-xs tw-text-muted"
            >
              Include context
            </label>
          </div>
        </div>

        <div className="tw-flex tw-items-center tw-gap-1">
          {hasMessages && (
            <button
              className="tw-rounded tw-p-1.5 tw-text-muted hover:tw-bg-modifier-hover hover:tw-text-normal"
              onClick={clear}
              title="Clear conversation"
            >
              <RotateCcw className="tw-size-4" />
            </button>
          )}

          {isStreaming ? (
            <button
              className="tw-rounded tw-bg-modifier-error tw-p-1.5 tw-text-on-accent hover:tw-bg-modifier-error-hover"
              onClick={stop}
              title="Stop"
            >
              <Square className="tw-size-4" />
            </button>
          ) : (
            <button
              className="tw-rounded tw-bg-interactive-accent tw-p-1.5 tw-text-on-accent hover:tw-bg-interactive-accent-hover disabled:tw-opacity-50"
              onClick={handleSubmit}
              disabled={!inputText.trim()}
              title="Send"
            >
              <Send className="tw-size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

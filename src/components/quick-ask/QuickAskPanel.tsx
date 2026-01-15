/**
 * QuickAskPanel - Main UI component for Quick Ask feature.
 * Provides multi-turn chat interface with Copy/Insert/Replace actions.
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import { Notice } from "obsidian";
import { Send, Square, RotateCcw, X } from "lucide-react";
import { useModelKey } from "@/aiParams";
import { useSettingsValue, updateSetting } from "@/settings/model";
import { cleanMessageForCopy, insertIntoEditor } from "@/utils";
import { ModelSelector } from "@/components/ui/ModelSelector";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuickAskSession } from "./useQuickAskSession";
import { QuickAskMessageComponent } from "./QuickAskMessage";
import { QuickAskInput } from "./QuickAskInput";
// TODO: Uncomment when Edit/Edit-Direct modes are implemented
// import { ModeSelector } from "./ModeSelector";
// import { modeRegistry } from "./modeRegistry";
import type { QuickAskPanelProps } from "./types";
import { Button } from "@/components/ui/button";

/**
 * QuickAskPanel - Floating panel for Quick Ask interactions.
 */
export function QuickAskPanel({
  plugin,
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
  // TODO: Uncomment when Edit/Edit-Direct modes are implemented
  // const [mode, setMode] = useState<QuickAskMode>("ask");
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get current active file for @ mention context
  const currentActiveFile = plugin.app.workspace.getActiveFile();

  // Settings
  const settings = useSettingsValue();
  const [globalModelKey] = useModelKey();
  const selectedModelKey = settings.quickCommandModelKey ?? globalModelKey;
  // Use local state for includeNoteContext to ensure immediate UI updates
  const [includeNoteContext, setIncludeNoteContext] = useState(
    () => settings.quickCommandIncludeNoteContext
  );

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
  // TODO: Uncomment when Edit/Edit-Direct modes are implemented
  // const availableModes = modeRegistry.getAvailable(hasSelection);

  // Keep mode valid when selection state changes
  // TODO: Uncomment when Edit/Edit-Direct modes are implemented
  // useEffect(() => {
  //   const modes = modeRegistry.getAvailable(hasSelection);
  //   if (!modes.some((m) => m.id === mode)) {
  //     setMode(modes[0]?.id ?? "ask");
  //   }
  // }, [hasSelection, mode]);

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; panelX: number; panelY: number } | null>(
    null
  );

  // Resize state
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef<{
    direction: "right" | "bottom" | "bottom-right" | "bottom-left";
    x: number;
    y: number;
    width: number;
    height: number;
    panelX: number;
    panelY: number;
  } | null>(null);
  const [panelSize, setPanelSize] = useState<{ width: number; height: number } | null>(null);

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
    const text = inputText;
    setInputText("");  // Clear input immediately before sending
    await sendMessage(text);
  }, [inputText, isStreaming, sendMessage]);

  // Keyboard handler - only handle Escape (Enter is handled by QuickAskInput)
  // Allow Lexical typeahead (e.g. @ menu) to consume Escape first
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [onClose]
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
    setIncludeNoteContext(checked);
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

  // Resize handling
  const handleResizeStart = useCallback(
    (direction: "right" | "bottom" | "bottom-right" | "bottom-left") =>
      (e: React.MouseEvent) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        resizeStartRef.current = {
          direction,
          x: e.clientX,
          y: e.clientY,
          width: rect.width,
          height: rect.height,
          panelX: rect.left,
          panelY: rect.top,
        };
        setIsResizing(true);
        e.preventDefault();
        e.stopPropagation();
      },
    []
  );

  useEffect(() => {
    if (!isResizing) return;

    const direction = resizeStartRef.current?.direction;
    const cursor =
      direction === "right"
        ? "ew-resize"
        : direction === "bottom"
          ? "ns-resize"
          : direction === "bottom-left"
            ? "nesw-resize"
            : "nwse-resize";

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeStartRef.current || !containerRef.current) return;

      const deltaX = e.clientX - resizeStartRef.current.x;
      const deltaY = e.clientY - resizeStartRef.current.y;

      let newWidth = resizeStartRef.current.width;
      let newHeight = resizeStartRef.current.height;
      let newX = resizeStartRef.current.panelX;

      if (
        resizeStartRef.current.direction === "right" ||
        resizeStartRef.current.direction === "bottom-right"
      ) {
        newWidth = Math.max(300, resizeStartRef.current.width + deltaX);
      }
      if (resizeStartRef.current.direction === "bottom-left") {
        const proposedWidth = resizeStartRef.current.width - deltaX;
        newWidth = Math.max(300, proposedWidth);
        newX = resizeStartRef.current.panelX + (resizeStartRef.current.width - newWidth);
      }
      if (
        resizeStartRef.current.direction === "bottom" ||
        resizeStartRef.current.direction === "bottom-right" ||
        resizeStartRef.current.direction === "bottom-left"
      ) {
        newHeight = Math.max(200, resizeStartRef.current.height + deltaY);
      }

      setPanelSize({ width: newWidth, height: newHeight });
      onResize?.({ width: newWidth, height: newHeight });
      if (newX !== resizeStartRef.current.panelX) {
        onDragOffset?.({ x: newX, y: resizeStartRef.current.panelY });
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizeStartRef.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, onResize, onDragOffset]);

  // Pre-compute selection validity to avoid repeated calls in render
  const selectionValid = hasSelection ? isSelectionValid() : false;

  return (
    <div
      ref={containerRef}
      className="tw-group tw-relative tw-flex tw-flex-col tw-rounded-lg tw-rounded-b-none tw-border tw-border-solid tw-border-border tw-bg-primary tw-shadow-lg"
      style={
        panelSize
          ? {
              width: panelSize.width,
              maxWidth: panelSize.width,
              ...(panelSize.height
                ? { height: panelSize.height, maxHeight: panelSize.height }
                : {}),
            }
          : undefined
      }
      onKeyDown={handleKeyDown}
    >
      {/* Drag handle */}
      <div
        className="tw-flex tw-h-4 tw-cursor-grab tw-items-center tw-justify-center hover:tw-bg-[color-mix(in_srgb,var(--background-modifier-hover)_20%,transparent)] active:tw-cursor-grabbing"
        onMouseDown={handleDragStart}
      >
        <div className="tw-h-[5px] tw-w-16 tw-rounded-sm tw-bg-[color-mix(in_srgb,var(--text-muted)_40%,transparent)] hover:tw-bg-[color-mix(in_srgb,var(--text-muted)_65%,transparent)]" />
      </div>

      {/* Chat area - shown above input when there are messages (like YOLO) */}
      {hasMessages && (
        <div
          ref={chatAreaRef}
          className="tw-flex tw-flex-col tw-gap-2 tw-overflow-y-auto tw-px-3 tw-py-2"
          style={{ maxHeight: panelSize?.height ? "none" : "300px" }}
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
              isReplaceValid={selectionValid}
              plugin={plugin}
            />
          ))}
        </div>
      )}

      {/* Spacer to push toolbar to bottom when panel is resized but no messages */}
      {!hasMessages && panelSize?.height && <div className="tw-flex-1" />}

      {/* Input area - below chat area when there are messages */}
      <div className="tw-relative tw-px-3 tw-pb-1 tw-pt-2">
        <QuickAskInput
          value={inputText}
          onChange={setInputText}
          onSubmit={handleSubmit}
          sendShortcut={settings.defaultSendShortcut}
          placeholder="Ask a question... "
          disabled={isStreaming}
          currentActiveFile={currentActiveFile}
        />
        <Button
          className="tw-absolute tw-right-4 tw-top-3 tw-rounded tw-bg-opacity-100 tw-p-1 tw-text-normal"
          variant={'ghost2'}
          onClick={onClose}
          title="Close"
        >
          <X className="tw-size-4" />
        </Button>
      </div>

      {/* Toolbar - always at bottom */}
      <div className="tw-mt-auto tw-flex tw-items-center tw-justify-between tw-gap-2 tw-border-t tw-border-solid tw-border-border tw-px-3 tw-py-1.5">
        <div className="tw-flex tw-items-center tw-gap-1">
          {/* TODO: Uncomment when Edit/Edit-Direct modes are implemented
          <ModeSelector
            modes={availableModes}
            value={mode}
            onChange={setMode}
            disabled={isStreaming}
          />
          */}

          <ModelSelector
            size="sm"
            variant="ghost"
            value={selectedModelKey}
            onChange={handleModelChange}
          />

          <div className="tw-flex tw-items-center tw-gap-1.5">
            <Checkbox
              id="quickAskIncludeContext"
              checked={includeNoteContext}
              onCheckedChange={(checked) => handleIncludeNoteContextChange(!!checked)}
              className="tw-size-3.5"
            />
            <label
              htmlFor="quickAskIncludeContext"
              className="tw-cursor-pointer tw-text-xs tw-text-muted"
            >
              Note
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
              <RotateCcw className="tw-size-3.5" />
            </button>
          )}

          {isStreaming ? (
            <button
              className="tw-rounded tw-bg-modifier-error tw-p-1.5 tw-text-on-accent hover:tw-bg-modifier-error-hover"
              onClick={stop}
              title="Stop"
            >
              <Square className="tw-size-3.5" />
            </button>
          ) : (
            <button
              className="tw-rounded tw-bg-interactive-accent tw-p-1.5 tw-text-on-accent hover:tw-bg-interactive-accent-hover disabled:tw-opacity-50"
              onClick={handleSubmit}
              disabled={!inputText.trim()}
              title="Send"
            >
              <Send className="tw-size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Resize handles */}
      <div
        className="tw-absolute tw-right-0 tw-top-4 tw-h-[calc(100%-16px)] tw-w-1 tw-cursor-ew-resize"
        onMouseDown={handleResizeStart("right")}
      />
      <div
        className="tw-absolute tw-bottom-0 tw-left-0 tw-h-1 tw-w-full tw-cursor-ns-resize"
        onMouseDown={handleResizeStart("bottom")}
      />
      <div
        className="quick-ask-resize-indicator-left tw-absolute tw-bottom-0 tw-left-0 tw-size-3 tw-cursor-nesw-resize"
        onMouseDown={handleResizeStart("bottom-left")}
      />
      <div
        className="quick-ask-resize-indicator-right tw-z-10 tw-absolute tw-bottom-0 tw-right-0 tw-size-3 tw-cursor-nwse-resize"
        onMouseDown={handleResizeStart("bottom-right")}
      />
    </div>
  );
}

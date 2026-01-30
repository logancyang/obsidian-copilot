/**
 * QuickAskPanel - Main UI component for Quick Ask feature.
 * Provides multi-turn chat interface with Copy/Insert/Replace actions.
 *
 * Note: This component fills its container (w-full h-full).
 * All positioning and sizing is managed by QuickAskOverlay.
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Notice } from "obsidian";
import { Send, Square, X, MessageSquareX } from "lucide-react";
import { useModelKey } from "@/aiParams";
import { useDraggable } from "@/hooks/use-draggable";
import type { ResizeDirection } from "@/hooks/use-resizable";
import { useSettingsValue, updateSetting } from "@/settings/model";
import { cleanMessageForCopy } from "@/utils";
import { ModelSelector } from "@/components/ui/ModelSelector";
import { Checkbox } from "@/components/ui/checkbox";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { useQuickAskSession } from "./useQuickAskSession";
import { QuickAskMessageComponent } from "./QuickAskMessage";
import { QuickAskInput } from "./QuickAskInput";
import { SelectedContent } from "@/components/command-ui";
// TODO: Uncomment when Edit/Edit-Direct modes are implemented
// import { ModeSelector } from "./ModeSelector";
// import { modeRegistry } from "./modeRegistry";
import type { QuickAskPanelProps } from "./types";
import type { ReplaceInvalidReason } from "@/editor/replaceGuard";
import { Button } from "@/components/ui/button";

/**
 * QuickAskPanel - Floating panel for Quick Ask interactions.
 * Fills its container; sizing is controlled by QuickAskOverlay.
 */
export function QuickAskPanel({
  plugin,
  view,
  selectedText,
  replaceGuard,
  onClose,
  onDragOffset,
  onResizeStart,
  hasCustomHeight,
}: QuickAskPanelProps) {
  // UI state
  const [inputText, setInputText] = useState("");
  // TODO: Uncomment when Edit/Edit-Direct modes are implemented
  // const [mode, setMode] = useState<QuickAskMode>("ask");
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isChatPinnedToBottomRef = useRef(true);

  // Get current active file for @ mention context
  const currentActiveFile = plugin.app.workspace.getActiveFile();
  // Reason: Snapshot file path at mount time for stable Markdown link resolution.
  // Using dynamic getActiveFile() would cause links to resolve against
  // whichever note the user switches to after opening Quick Ask.
  const filePathSnapshotRef = useRef<string | null>(currentActiveFile?.path ?? null);
  const filePathSnapshot = filePathSnapshotRef.current;

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
  // Reason: Use replaceGuard.getRange() as single source of truth for selection state.
  // Previously used selectionFrom/selectionTo props that were stale and never updated.
  const selectionRange = replaceGuard.getRange();
  const hasSelection = !!selectionRange && selectionRange.from !== selectionRange.to;
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

  const lastMessageId = messages[messages.length - 1]?.id;
  const lastAssistantIdx = useMemo(() => {
    return messages.reduce((lastIdx, m, i) => (m.role === "assistant" ? i : lastIdx), -1);
  }, [messages]);

  // Drag handling using shared hook
  const getCurrentPanelPosition = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    return rect ? { x: rect.left, y: rect.top } : { x: 0, y: 0 };
  }, []);

  const handleDragPositionChange = useCallback(
    (pos: { x: number; y: number }) => {
      onDragOffset?.(pos);
    },
    [onDragOffset]
  );

  const { handleMouseDown: handleDragMouseDown } = useDraggable({
    dragRef: containerRef,
    bounds: null,
    writeToDom: false,
    getPosition: getCurrentPanelPosition,
    onPositionChange: handleDragPositionChange,
  });

  // Resize handle - just forward to Overlay
  const handleResizeMouseDown = useCallback(
    (direction: ResizeDirection) =>
      (e: React.MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        onResizeStart?.(direction, { x: e.clientX, y: e.clientY });
      },
    [onResizeStart]
  );

  // Submit handler
  const handleSubmit = useCallback(async () => {
    if (!inputText.trim() || isStreaming) return;
    const text = inputText;
    setInputText(""); // Clear input immediately before sending
    await sendMessage(text);
  }, [inputText, isStreaming, sendMessage]);

  // Keyboard handler - only handle Escape (Enter is handled by QuickAskInput)
  // Allow Lexical typeahead (e.g. @ menu) to consume Escape first
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // P0 Fix: Always stop propagation to prevent CM6 from handling
      e.stopPropagation();
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    },
    [onClose]
  );

  // P0 Fix: Generic handler to stop propagation for other keyboard events
  const handleStopPropagation = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
  }, []);

  // Track whether the user is at (or near) the bottom; only auto-scroll when pinned.
  useEffect(() => {
    const el = chatAreaRef.current;
    if (!el) return;

    const thresholdPx = 24;

    /** Returns true if the user is close enough to the bottom to auto-follow new messages. */
    const isAtBottom = (): boolean => {
      return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx;
    };

    const handleScroll = () => {
      isChatPinnedToBottomRef.current = isAtBottom();
    };

    // Initialize.
    isChatPinnedToBottomRef.current = isAtBottom();
    el.addEventListener("scroll", handleScroll);

    return () => {
      el.removeEventListener("scroll", handleScroll);
    };
  }, [hasMessages]);

  // Auto-scroll to bottom only when pinned
  useEffect(() => {
    const el = chatAreaRef.current;
    if (!el) return;
    if (!isChatPinnedToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Action handlers
  const handleCopy = useCallback(
    async (messageId: string) => {
      const message = messages.find((m) => m.id === messageId);
      if (message && message.role === "assistant") {
        const cleaned = cleanMessageForCopy(message.content);
        try {
          await navigator.clipboard.writeText(cleaned);
          new Notice("Copied to clipboard");
        } catch {
          new Notice("Failed to copy to clipboard");
        }
      }
    },
    [messages]
  );

  const handleInsert = useCallback(
    (messageId: string) => {
      const message = messages.find((m) => m.id === messageId);
      if (!message || message.role !== "assistant") return;

      try {
        const cleaned = cleanMessageForCopy(message.content);
        const insertPos = view.state.selection.main.to;

        // Reason: CM6 normalizes \r\n → \n internally, so string.length would overcount.
        // Using state.toText() ensures the length matches CM6's internal representation.
        const insertText = view.state.toText(cleaned);

        view.dispatch({
          changes: { from: insertPos, to: insertPos, insert: insertText },
          // Select the inserted content to highlight it
          selection: { anchor: insertPos, head: insertPos + insertText.length },
        });
        // Ensure editor gets focus so selection is visible
        view.focus();

        new Notice("Inserted");
        onClose();
      } catch {
        // View might be destroyed or in invalid state
        new Notice("Failed to insert. Editor may have changed.");
      }
    },
    [messages, view, onClose]
  );

  const handleReplace = useCallback(
    (messageId: string) => {
      const message = messages.find((m) => m.id === messageId);
      if (!message || message.role !== "assistant") return;

      const cleaned = cleanMessageForCopy(message.content);
      const result = replaceGuard.replace(cleaned);

      if (!result.ok) {
        new Notice(result.message ?? "Cannot replace.");
        return;
      }

      new Notice("Replaced");
      onClose();
    },
    [messages, replaceGuard, onClose]
  );

  const handleModelChange = useCallback((modelKey: string) => {
    updateSetting("quickCommandModelKey", modelKey);
  }, []);

  const handleIncludeNoteContextChange = useCallback((checked: boolean) => {
    setIncludeNoteContext(checked);
    updateSetting("quickCommandIncludeNoteContext", checked);
  }, []);

  // Only compute selection validity when not streaming (performance optimization)
  // During streaming, the button is not clickable anyway
  const replaceValidation = hasSelection && !isStreaming ? replaceGuard.validate() : null;
  const selectionValid = !!replaceValidation?.ok;
  const replaceInvalidReason: ReplaceInvalidReason | null = replaceValidation?.reason ?? null;
  // Track if button is disabled due to streaming (for accurate tooltip)
  const isDisabledDueToStreaming = hasSelection && isStreaming;

  return (
    <div
      ref={containerRef}
      className={`tw-group tw-relative tw-flex tw-size-full tw-flex-col tw-rounded-lg tw-rounded-b-none tw-border tw-border-solid tw-border-border tw-bg-primary tw-shadow-lg${
        hasMessages && !hasCustomHeight ? " tw-max-h-[min(500px,70vh)]" : ""
      }`}
      onKeyDown={handleKeyDown}
      onKeyUp={handleStopPropagation}
      onBeforeInput={handleStopPropagation}
      onInput={handleStopPropagation}
      onMouseDown={handleStopPropagation}
      onMouseUp={handleStopPropagation}
      onClick={handleStopPropagation}
    >
      {/* Header: drag handle + close button */}
      <div className="tw-relative tw-flex-none">
        <div
          className="tw-flex tw-h-4 tw-cursor-grab tw-items-center tw-justify-center hover:tw-bg-[color-mix(in_srgb,var(--background-modifier-hover)_20%,transparent)] active:tw-cursor-grabbing"
          onMouseDown={handleDragMouseDown}
        >
          <div className="tw-h-[5px] tw-w-16 tw-rounded-sm tw-bg-[color-mix(in_srgb,var(--text-muted)_40%,transparent)] hover:tw-bg-[color-mix(in_srgb,var(--text-muted)_65%,transparent)]" />
        </div>
        <Button
          className="tw-absolute tw-right-2 tw-top-1 tw-rounded tw-p-1 tw-text-normal"
          variant="ghost2"
          onClick={onClose}
          title="Close"
        >
          <X className="tw-size-4" />
        </Button>
      </div>

      {/* Selected text preview - shown below header when text is selected */}
      <SelectedContent content={selectedText.trim()} className="tw-mt-3 tw-px-3" />

      {/* Chat area - shown above input when there are messages (like YOLO) */}
      {hasMessages && (
        <div
          ref={chatAreaRef}
          data-quick-ask-scroll="true"
          className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-gap-2 tw-overflow-y-auto tw-px-3 tw-py-2"
        >
          {messages.map((msg, idx) => (
            <QuickAskMessageComponent
              key={msg.id}
              message={msg}
              isStreaming={isStreaming && msg.id === lastMessageId && msg.role === "assistant"}
              isLastAssistantMessage={msg.role === "assistant" && idx === lastAssistantIdx}
              onCopy={handleCopy}
              onInsert={handleInsert}
              onReplace={handleReplace}
              hasSelection={hasSelection}
              isReplaceValid={selectionValid}
              replaceInvalidReason={replaceInvalidReason}
              isDisabledDueToStreaming={isDisabledDueToStreaming}
              filePathSnapshot={filePathSnapshot}
              plugin={plugin}
            />
          ))}
        </div>
      )}

      {/* Spacer to push toolbar to bottom when panel is resized but no messages */}
      {!hasMessages && hasCustomHeight && <div className="tw-flex-1" />}

      {/* Input area - below chat area when there are messages */}
      <div className="tw-px-3 tw-pb-1 tw-pt-2">
        <QuickAskInput
          value={inputText}
          onChange={setInputText}
          onSubmit={handleSubmit}
          sendShortcut={settings.defaultSendShortcut}
          placeholder={isStreaming ? "Generating..." : "Ask a question... "}
          currentActiveFile={currentActiveFile}
        />
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
            disabled={isStreaming}
          />

          <div className="tw-flex tw-items-center tw-gap-1.5">
            <Checkbox
              id="quickAskIncludeContext"
              checked={includeNoteContext}
              onCheckedChange={(checked) => handleIncludeNoteContextChange(!!checked)}
              className="tw-size-3.5"
              disabled={isStreaming}
            />
            <label
              htmlFor="quickAskIncludeContext"
              className="tw-cursor-pointer tw-text-xs tw-text-muted"
            >
              Note
            </label>
            <HelpTooltip content="Include the active note's content as context" side="top" />
          </div>
        </div>

        <div className="tw-flex tw-items-center tw-gap-1">
          {hasMessages && (
            <Button
              variant="ghost2"
              size="icon"
              className="hover:tw-bg-modifier-hover"
              onClick={clear}
              title="Clear conversation"
            >
              <MessageSquareX className="tw-size-4" />
            </Button>
          )}

          {isStreaming ? (
            <Button variant="destructive" size="icon" onClick={stop} title="Stop generating">
              <Square className="tw-size-4" />
            </Button>
          ) : (
            <Button
              variant="default"
              size="icon"
              onClick={handleSubmit}
              disabled={!inputText.trim()}
              title="Send message"
            >
              <Send className="tw-size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Resize handles */}
      <div
        className="tw-absolute tw-right-0 tw-top-4 tw-h-[calc(100%-16px)] tw-w-1 tw-cursor-ew-resize"
        onMouseDown={handleResizeMouseDown("right")}
      />
      <div
        className="tw-absolute tw-bottom-0 tw-left-0 tw-h-1 tw-w-full tw-cursor-ns-resize"
        onMouseDown={handleResizeMouseDown("bottom")}
      />
      <div
        className="quick-ask-resize-indicator-left tw-absolute tw-bottom-0 tw-left-0 tw-size-3 tw-cursor-nesw-resize"
        onMouseDown={handleResizeMouseDown("bottom-left")}
      />
      <div
        className="quick-ask-resize-indicator-right tw-absolute tw-bottom-0 tw-right-0 tw-z-[10] tw-size-3 tw-cursor-nwse-resize"
        onMouseDown={handleResizeMouseDown("bottom-right")}
      />
    </div>
  );
}

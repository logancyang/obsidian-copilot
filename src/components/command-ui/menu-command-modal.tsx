import * as React from "react";
import { useEffect, useRef } from "react";
import { Send } from "lucide-react";
import { Platform } from "obsidian";
import { DraggableModal } from "./draggable-modal";
import { CommandLabel } from "./command-label";
import { ContentArea, type ContentState } from "./content-area";
import { FollowUpInput } from "./follow-up-input";
import { ModelSelector } from "@/components/ui/ModelSelector";
import { Checkbox } from "@/components/ui/checkbox";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { ActionButtons } from "./action-buttons";
import { MODAL_MIN_HEIGHT_COMPACT, MODAL_MIN_HEIGHT_EXPANDED } from "./constants";
import { Button } from "@/components/ui/button";

interface MenuCommandModalProps {
  open: boolean;
  onClose: () => void;
  /** Icon to display. Pass null to hide icon, undefined for default icon. */
  commandIcon?: React.ReactNode | null;
  commandLabel: string;
  contentState: ContentState;
  /** Editable content value (used when content is editable) */
  editableContent?: string;
  /** Callback when editable content changes */
  onEditableContentChange?: (value: string) => void;
  followUpValue: string;
  onFollowUpChange: (value: string) => void;
  onFollowUpSubmit: () => void;
  /** Selected model key */
  selectedModel: string;
  /** Callback when model changes */
  onSelectModel: (modelKey: string) => void;
  onStop?: () => void;
  onCopy?: () => void;
  onInsert?: () => void;
  onReplace?: () => void;
  /** Initial position for the modal (defaults to center of screen) */
  initialPosition?: { x: number; y: number };
  /**
   * Bottom-anchor Y for "above" placement. Passed through to DraggableModal.
   * When set, the panel grows upward as content loads.
   */
  anchorBottom?: number;
  /** Enable QuickAsk-style resize (height only). */
  resizable?: boolean;
  /** Hide ContentArea when state is idle (for Quick Command mode) */
  hideContentAreaOnIdle?: boolean;
  /** Include note context checkbox state (only shown if provided) */
  includeNoteContext?: boolean;
  /** Callback when include note context changes */
  onIncludeNoteContextChange?: (checked: boolean) => void;
  /** Optional callback to render markdown content (enables preview mode in ContentArea) */
  renderMarkdown?: (content: string, el: HTMLElement) => Promise<void>;
}

/**
 * Modal for executing menu commands (e.g., Summarize, Translate).
 * Layout:
 * - Command label (flex-none)
 * - Content area for AI response (flex-1, min-h: 160px)
 * - Follow-up input (flex-none)
 * - Bottom toolbar with model selector and action buttons (flex-none)
 */
export function MenuCommandModal({
  open,
  onClose,
  commandIcon,
  commandLabel,
  contentState,
  editableContent,
  onEditableContentChange,
  followUpValue,
  onFollowUpChange,
  onFollowUpSubmit,
  selectedModel,
  onSelectModel,
  onStop,
  onCopy,
  onInsert,
  onReplace,
  initialPosition,
  anchorBottom,
  resizable = false,
  hideContentAreaOnIdle = false,
  includeNoteContext,
  onIncludeNoteContextChange,
  renderMarkdown,
}: MenuCommandModalProps) {
  // P0 Fix: Treat streaming as "loading" state to show Stop button
  const actionState =
    contentState.type === "loading"
      ? "loading"
      : contentState.type === "result" && contentState.isStreaming
        ? "loading"
        : contentState.type === "result"
          ? "result"
          : "idle";

  // Busy == generating response (loading/streaming). While busy we still allow typing,
  // but we disable submitting to avoid concurrent requests.
  const isBusy =
    contentState.type === "loading" ||
    (contentState.type === "result" && !!contentState.isStreaming);

  // Content is editable when we have a result and not streaming
  const isEditable =
    contentState.type === "result" && !contentState.isStreaming && !!onEditableContentChange;

  // Ref to an element inside this modal, used to resolve ownerDocument and scope shortcuts
  const innerRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcuts: Ctrl+Enter → Replace, Ctrl+Shift+Enter → Insert
  // Mirrors DraggableModal's Escape handling: uses ownerDocument for popout windows,
  // and scopes to the focused modal to avoid firing across multiple open modals.
  useEffect(() => {
    if (!open) return;

    const modalEl = innerRef.current?.closest<HTMLElement>('[data-copilot-draggable-modal="true"]');
    const ownerDocument = modalEl?.doc ?? activeDocument;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle when result is ready and not busy
      if (actionState !== "result") return;

      const modKey = Platform.isMacOS ? e.metaKey : e.ctrlKey;
      if (e.key !== "Enter" || !modKey) return;

      // Scope to focused modal: only handle if active element is inside this modal.
      // Avoid `instanceof Element` — it fails cross-realm (popout windows have their own Element).
      const activeEl = ownerDocument.activeElement;
      if (modalEl && (!activeEl || !modalEl.contains(activeEl))) return;

      if (e.shiftKey) {
        // Ctrl/Cmd + Shift + Enter → Insert
        e.preventDefault();
        e.stopPropagation();
        onInsert?.();
      } else {
        // Ctrl/Cmd + Enter → Replace
        e.preventDefault();
        e.stopPropagation();
        onReplace?.();
      }
    };

    ownerDocument.addEventListener("keydown", handleKeyDown);
    return () => ownerDocument.removeEventListener("keydown", handleKeyDown);
  }, [open, actionState, onInsert, onReplace]);

  // Conditionally show ContentArea based on hideContentAreaOnIdle prop
  const showContentArea = hideContentAreaOnIdle ? contentState.type !== "idle" : true;

  // Dynamic minHeight: compact when ContentArea is hidden, normal when shown
  const dynamicMinHeight = showContentArea ? MODAL_MIN_HEIGHT_EXPANDED : MODAL_MIN_HEIGHT_COMPACT;

  return (
    <DraggableModal
      open={open}
      onClose={onClose}
      initialPosition={initialPosition}
      anchorBottom={anchorBottom}
      resizable={resizable}
      minHeight={resizable ? dynamicMinHeight : undefined}
      closeOnEscapeFromOutside
    >
      {/* Command Label - flex-none */}
      <CommandLabel
        icon={commandIcon}
        label={commandLabel}
        className="tw-border-b tw-border-border"
      />

      {/* Content Area - flex-1, editable when result is ready */}
      {showContentArea && (
        <ContentArea
          state={contentState}
          editable={isEditable}
          value={editableContent}
          onChange={onEditableContentChange}
          disableAutoGrow={resizable}
          minHeight={resizable ? "0px" : undefined}
          renderMarkdown={renderMarkdown}
        />
      )}

      {/* Follow-up Input - flex-none, allow typing during streaming but disable submit */}
      <FollowUpInput
        value={followUpValue}
        onChange={onFollowUpChange}
        onSubmit={() => {
          if (!isBusy) onFollowUpSubmit();
        }}
        onClear={() => onFollowUpChange("")}
        placeholder="Enter follow-up instructions..."
        className={!showContentArea ? "tw-mt-auto" : undefined}
        hint={isBusy ? "Generating..." : undefined}
        autoFocus
      />

      {/* Bottom Toolbar - flex-none */}
      <div
        ref={innerRef}
        className="tw-flex tw-flex-none tw-items-center tw-justify-between tw-border-t tw-border-border tw-px-4 tw-py-3"
      >
        <div className="tw-flex tw-items-center tw-gap-3">
          <ModelSelector
            size="sm"
            variant="ghost"
            value={selectedModel}
            onChange={onSelectModel}
            disabled={isBusy}
          />
          {onIncludeNoteContextChange && (
            <div className="tw-flex tw-items-center tw-gap-1.5">
              <Checkbox
                id="menuCommandIncludeContext"
                checked={includeNoteContext}
                onCheckedChange={(checked) => onIncludeNoteContextChange(!!checked)}
                className="tw-size-3.5"
                disabled={isBusy}
              />
              <label
                htmlFor="menuCommandIncludeContext"
                className="tw-cursor-pointer tw-text-xs tw-text-muted"
              >
                Note
              </label>
              <HelpTooltip content="Include the active note's content as context" side="top" />
            </div>
          )}
        </div>
        <div className="tw-flex tw-items-center tw-gap-2">
          {/* Send button: shown when content area is hidden (idle Quick Command mode) */}
          {hideContentAreaOnIdle && actionState === "idle" && (
            <Button
              variant="default"
              size="sm"
              onClick={onFollowUpSubmit}
              disabled={!followUpValue.trim() || isBusy}
              title="Send message"
            >
              <Send className="tw-mr-1 tw-size-4" />
              Send
            </Button>
          )}
          <ActionButtons
            state={actionState}
            onStop={onStop}
            onCopy={onCopy}
            onInsert={onInsert}
            onReplace={onReplace}
          />
        </div>
      </div>
    </DraggableModal>
  );
}

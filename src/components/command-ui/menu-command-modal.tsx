import * as React from "react";
import { Send } from "lucide-react";
import { DraggableModal } from "./draggable-modal";
import { CommandLabel } from "./command-label";
import { SelectedContent } from "./selected-content";
import { ContentArea, type ContentState } from "./content-area";
import { FollowUpInput } from "./follow-up-input";
import { ModelSelector } from "@/components/ui/ModelSelector";
import { Checkbox } from "@/components/ui/checkbox";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { ActionButtons } from "./action-buttons";
import { Button } from "@/components/ui/button";

interface MenuCommandModalProps {
  open: boolean;
  onClose: () => void;
  /** Icon to display. Pass null to hide icon, undefined for default icon. */
  commandIcon?: React.ReactNode | null;
  commandLabel: string;
  selectedText: string;
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
  onInsert?: () => void;
  onReplace?: () => void;
  /** Initial position for the modal (defaults to center of screen) */
  initialPosition?: { x: number; y: number };
  /** Enable QuickAsk-style resize (height only). */
  resizable?: boolean;
  /** Hide ContentArea when state is idle (for Quick Command mode) */
  hideContentAreaOnIdle?: boolean;
  /** Include note context checkbox state (only shown if provided) */
  includeNoteContext?: boolean;
  /** Callback when include note context changes */
  onIncludeNoteContextChange?: (checked: boolean) => void;
}

/**
 * Modal for executing menu commands (e.g., Summarize, Translate).
 * Layout:
 * - Command label (flex-none)
 * - Selected content with hover expand (flex-none)
 * - Content area for AI response (flex-1, min-h: 160px)
 * - Follow-up input (flex-none)
 * - Bottom toolbar with model selector and action buttons (flex-none)
 */
export function MenuCommandModal({
  open,
  onClose,
  commandIcon,
  commandLabel,
  selectedText,
  contentState,
  editableContent,
  onEditableContentChange,
  followUpValue,
  onFollowUpChange,
  onFollowUpSubmit,
  selectedModel,
  onSelectModel,
  onStop,
  onInsert,
  onReplace,
  initialPosition,
  resizable = false,
  hideContentAreaOnIdle = false,
  includeNoteContext,
  onIncludeNoteContextChange,
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

  // Conditionally show ContentArea based on hideContentAreaOnIdle prop
  const showContentArea = hideContentAreaOnIdle ? contentState.type !== "idle" : true;

  // Dynamic minHeight: compact when ContentArea is hidden, normal when shown
  const dynamicMinHeight = showContentArea ? 400 : 180;

  return (
    <DraggableModal
      open={open}
      onClose={onClose}
      initialPosition={initialPosition}
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

      {/* Selected Content - flex-none, hover to expand */}
      <SelectedContent content={selectedText} />

      {/* Content Area - flex-1, editable when result is ready */}
      {showContentArea && (
        <ContentArea
          state={contentState}
          editable={isEditable}
          value={editableContent}
          onChange={onEditableContentChange}
          disableAutoGrow={resizable}
          minHeight={resizable ? "0px" : undefined}
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
      <div className="tw-flex tw-flex-none tw-items-center tw-justify-between tw-border-t tw-border-border tw-px-4 tw-py-3">
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
            onInsert={onInsert}
            onReplace={onReplace}
          />
        </div>
      </div>
    </DraggableModal>
  );
}

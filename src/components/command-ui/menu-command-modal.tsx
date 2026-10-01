import * as React from "react";
import { Send } from "lucide-react";
import { Platform } from "obsidian";
import { DraggableModal } from "./draggable-modal";
import { CommandLabel } from "./command-label";
import { ContentArea, type ContentState } from "./content-area";
import { FollowUpInput } from "./follow-up-input";
import { ModelSelector, type ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { Checkbox } from "@/components/ui/checkbox";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { ActionButtons } from "./action-buttons";
import { ModelSettingsButton } from "./model-settings-button";
import { MODAL_MIN_HEIGHT_COMPACT, MODAL_MIN_HEIGHT_EXPANDED } from "./constants";
import { Button } from "@/components/ui/button";
import { useSettingsValue } from "@/settings/model";

interface MenuCommandModalProps {
  open: boolean;
  onClose: () => void;
  commandIcon?: React.ReactNode | null;
  commandLabel: string;
  contentState: ContentState;
  editableContent?: string;
  onEditableContentChange?: (value: string) => void;
  followUpValue: string;
  onFollowUpChange: (value: string) => void;
  onFollowUpSubmit: () => void;
  selectedModel: string;
  onSelectModel: (modelKey: string) => void;
  models?: ModelSelectorEntry[];
  needsModel?: boolean;
  onOpenModelSettings?: (ownerWindow: Window) => void;
  onStop?: () => void;
  onRunAgain?: () => void;
  onCopy?: () => void;
  onInsert?: () => void;
  onReplace?: () => void;
  initialPosition?: { x: number; y: number };
  anchorBottom?: number;
  resizable?: boolean;
  hideContentAreaOnIdle?: boolean;
  includeNoteContext?: boolean;
  onIncludeNoteContextChange?: (checked: boolean) => void;
  renderMarkdown?: (content: string, el: HTMLElement) => Promise<void>;
}

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
  models,
  needsModel = false,
  onOpenModelSettings,
  onStop,
  onRunAgain,
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
  const settings = useSettingsValue();
  const actionState =
    contentState.type === "loading"
      ? "loading"
      : contentState.type === "result" && contentState.isStreaming
        ? "loading"
        : contentState.type === "result"
          ? "result"
          : "idle";

  const isBusy =
    contentState.type === "loading" ||
    (contentState.type === "result" && !!contentState.isStreaming);

  const isEditable =
    contentState.type === "result" && !contentState.isStreaming && !!onEditableContentChange;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (actionState !== "result") return;
    if (e.nativeEvent.isComposing) return;

    const modKey = Platform.isMacOS ? e.metaKey : e.ctrlKey;
    if (e.key !== "Enter" || !modKey) return;

    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey) {
      onInsert?.();
    } else {
      onReplace?.();
    }
  };

  const showContentArea = hideContentAreaOnIdle ? contentState.type !== "idle" : true;

  const dynamicMinHeight = showContentArea ? MODAL_MIN_HEIGHT_EXPANDED : MODAL_MIN_HEIGHT_COMPACT;

  return (
    <DraggableModal
      open={open}
      onClose={onClose}
      initialPosition={initialPosition}
      anchorBottom={anchorBottom}
      resizable={resizable}
      minHeight={resizable ? dynamicMinHeight : undefined}
      width="min(680px, 92vw)"
      closeOnEscapeFromOutside
    >
      <div onKeyDown={handleKeyDown} className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col">
        <CommandLabel
          icon={commandIcon}
          label={commandLabel}
          className="tw-border-b tw-border-border"
        />

        {showContentArea && (
          <ContentArea
            state={contentState}
            editable={isEditable}
            value={editableContent}
            onChange={onEditableContentChange}
            disableAutoGrow={resizable}
            minHeight={resizable ? "0px" : undefined}
            renderMarkdown={renderMarkdown}
            onCopy={onCopy}
          />
        )}

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

        <div className="tw-flex tw-flex-none tw-items-center tw-justify-between tw-border-t tw-border-border tw-px-4 tw-py-3">
          <div className="tw-flex tw-items-center tw-gap-3">
            <div className="tw-flex tw-items-center tw-gap-1">
              <ModelSelector
                size="sm"
                variant="ghost"
                value={selectedModel}
                onChange={onSelectModel}
                models={models ?? settings.activeModels}
                apiKeySettings={models ? undefined : settings}
                disabled={isBusy}
              />
              {onOpenModelSettings && (
                <ModelSettingsButton
                  needsModel={needsModel}
                  disabled={isBusy}
                  onClick={onOpenModelSettings}
                />
              )}
            </div>
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
              onRunAgain={onRunAgain}
              onInsert={onInsert}
              onReplace={onReplace}
            />
          </div>
        </div>
      </div>
    </DraggableModal>
  );
}

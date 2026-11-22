import React from "react";
import { MessageSquareX, Send, Square } from "lucide-react";
import { ModelSelector, type ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { Checkbox } from "@/components/ui/checkbox";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Button } from "@/components/ui/button";

export interface QuickAskFooterProps {
  models: ModelSelectorEntry[];
  selectedModel: string;
  onSelectModel: (modelKey: string) => void;
  includeNoteContext: boolean;
  onIncludeNoteContextChange: (checked: boolean) => void;
  isStreaming: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  onStop: () => void;
  onClear?: () => void;
}

export function QuickAskFooter({
  models,
  selectedModel,
  onSelectModel,
  includeNoteContext,
  onIncludeNoteContextChange,
  isStreaming,
  canSubmit,
  onSubmit,
  onStop,
  onClear,
}: QuickAskFooterProps) {
  return (
    <div className="tw-mt-auto tw-flex tw-items-center tw-justify-between tw-gap-2 tw-border-0 tw-border-t tw-border-solid tw-border-border tw-px-3 tw-py-1.5">
      <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-1">
        <ModelSelector
          size="sm"
          variant="ghost"
          value={selectedModel}
          models={models}
          onChange={onSelectModel}
          disabled={isStreaming}
        />

        <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-1.5">
          <Checkbox
            id="quickAskIncludeContext"
            checked={includeNoteContext}
            onCheckedChange={(checked) => onIncludeNoteContextChange(!!checked)}
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

      <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-1">
        {onClear && (
          <Button
            variant="ghost2"
            size="icon"
            className="hover:tw-bg-modifier-hover"
            onClick={onClear}
            title="Clear conversation"
          >
            <MessageSquareX className="tw-size-4" />
          </Button>
        )}

        {isStreaming ? (
          <Button variant="destructive" size="icon" onClick={onStop} title="Stop generating">
            <Square className="tw-size-4" />
          </Button>
        ) : (
          <Button
            variant="default"
            size="icon"
            onClick={onSubmit}
            disabled={!canSubmit}
            title="Send message"
          >
            <Send className="tw-size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

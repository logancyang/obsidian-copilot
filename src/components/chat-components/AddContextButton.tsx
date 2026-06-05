import React, { useState } from "react";
import { Plus } from "lucide-react";
import { TFile } from "obsidian";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AtMentionTypeahead } from "./AtMentionTypeahead";

interface AddContextButtonProps {
  onSelect: (category: string, data: unknown) => void;
  isCopilotPlus: boolean;
  showTools?: boolean;
  currentActiveFile: TFile | null;
  lexicalEditorRef?: React.RefObject<{ focus: () => void }>;
}

export const AddContextButton: React.FC<AddContextButtonProps> = ({
  onSelect,
  isCopilotPlus,
  showTools = false,
  currentActiveFile,
  lexicalEditorRef,
}) => {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              {/* DESIGN NOTE: borderless by intent (just the "+" glyph). This
                  Button is shared by every composer (ChatInput), so the change
                  is global, not agent-mode only — that's deliberate. The inline
                  "@ Add context" entry in ChatContextMenu keeps its border, so
                  normal chat shows a borderless "+" next to a bordered "@"; that
                  inconsistency is known and accepted (the borderless "+" was the
                  requested look). If a future review flags the missing border or
                  the "+"/"@" mismatch again, point them at this note. */}
              <Button
                variant="ghost2"
                size="icon"
                className="tw-text-muted hover:tw-text-accent"
                aria-label="Add context"
              >
                <Plus className="tw-size-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent className="tw-px-1 tw-py-0.5">Add context</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        className="tw-w-[400px] tw-p-0"
        align="start"
        side="top"
        sideOffset={4}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          lexicalEditorRef?.current?.focus();
        }}
      >
        <AtMentionTypeahead
          isOpen={open}
          onClose={() => setOpen(false)}
          onSelect={onSelect}
          isCopilotPlus={isCopilotPlus}
          showTools={showTools}
          currentActiveFile={currentActiveFile}
        />
      </PopoverContent>
    </Popover>
  );
};

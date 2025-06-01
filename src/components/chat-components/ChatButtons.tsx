import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { USER_SENDER } from "@/constants";
import { cn } from "@/lib/utils";
import { ChatMessage } from "@/sharedState";
import {
  Check,
  Copy,
  LibraryBig,
  PenSquare,
  RotateCw,
  TextCursorInput,
  Trash2,
} from "lucide-react";
import { Platform } from "obsidian";
import React from "react";

interface ChatButtonsProps {
  message: ChatMessage;
  onCopy: () => void;
  isCopied: boolean;
  onInsertIntoEditor?: () => void;
  onRegenerate?: () => void;
  onEdit?: () => void;
  onDelete: () => void;
  onShowSources?: () => void;
  hasSources: boolean;
}

export const ChatButtons: React.FC<ChatButtonsProps> = ({
  message,
  onCopy,
  isCopied,
  onInsertIntoEditor,
  onRegenerate,
  onEdit,
  onDelete,
  onShowSources,
  hasSources,
}) => {
  return (
    <div
      className={cn("tw-flex tw-gap-1", {
        "group-hover:opacity-100 opacity-0": !Platform.isMobile,
      })}
    >
      {message.sender === USER_SENDER ? (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost2" size="fit" onClick={onCopy} title="Copy">
                {isCopied ? <Check className="tw-size-4" /> : <Copy className="tw-size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={onEdit} variant="ghost2" size="fit" title="Edit">
                <PenSquare className="tw-size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={onDelete} variant="ghost2" size="fit" title="Delete">
                <Trash2 className="tw-size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        </>
      ) : (
        <>
          {hasSources && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={onShowSources} variant="ghost2" size="fit" title="Show Sources">
                  <LibraryBig className="tw-size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Show Sources</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={onInsertIntoEditor}
                variant="ghost2"
                size="fit"
                title="Insert / Replace at cursor"
              >
                <TextCursorInput className="tw-size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Insert / Replace at cursor</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost2" size="fit" onClick={onCopy} title="Copy">
                {isCopied ? <Check className="tw-size-4" /> : <Copy className="tw-size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={onRegenerate} variant="ghost2" size="fit" title="Regenerate">
                <RotateCw className="tw-size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Regenerate</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={onDelete} variant="ghost2" size="fit" title="Delete">
                <Trash2 className="tw-size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
};

import { Button } from "@/components/ui/button";
import { Platform } from "obsidian";
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
      className={cn("flex", {
        "group-hover:opacity-100 opacity-0": !Platform.isMobile,
      })}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost2" size="fit" onClick={onCopy} title="Copy">
            {isCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy</TooltipContent>
      </Tooltip>
      {message.sender === USER_SENDER ? (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={onEdit} variant="ghost2" size="fit" title="Edit">
                <PenSquare className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={onDelete} variant="ghost2" size="fit" title="Delete">
                <Trash2 className="size-4" />
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
                  <LibraryBig className="size-4" />
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
                title="Insert to note at cursor"
              >
                <TextCursorInput className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Insert to note at cursor</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={onRegenerate} variant="ghost2" size="fit" title="Regenerate">
                <RotateCw className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Regenerate</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={onDelete} variant="ghost2" size="fit" title="Delete">
                <Trash2 className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
};

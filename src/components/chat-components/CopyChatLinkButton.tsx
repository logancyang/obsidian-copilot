import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "lucide-react";
import React from "react";

export interface CopyChatLinkButtonProps {
  chatId?: string;
  onCopyLink?: (id: string) => void | Promise<void>;
}

/** Copy control shared by Quick Chat and Agent Mode. */
export function CopyChatLinkButton({ chatId, onCopyLink }: CopyChatLinkButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost2"
          size="icon"
          title="Copy Chat Link"
          disabled={!chatId || !onCopyLink}
          onClick={() => {
            if (chatId) void onCopyLink?.(chatId);
          }}
        >
          <Link className="tw-size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Copy Chat Link</TooltipContent>
    </Tooltip>
  );
}

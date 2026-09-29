import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "lucide-react";
import React from "react";

export interface CopyChatLinkButtonProps {
  onCopyLink?: () => void | Promise<void>;
}

export function CopyChatLinkButton({ onCopyLink }: CopyChatLinkButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost2"
          size="icon"
          title="Copy Chat Link"
          disabled={!onCopyLink}
          onClick={() => void onCopyLink?.()}
        >
          <Link className="tw-size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Copy Chat Link</TooltipContent>
    </Tooltip>
  );
}

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Undo2 } from "lucide-react";
import React from "react";

export interface RevokeButtonProps {
  label: string;
  blocked: string | null;
  tooltipSide: "left" | "bottom";
  className?: string;
  onRevoke: () => void;
}

export function RevokeButton({
  label,
  blocked,
  tooltipSide,
  className,
  onRevoke,
}: RevokeButtonProps): React.ReactElement {
  const button = (
    <Button
      variant="secondary"
      size="sm"
      aria-disabled={blocked !== null || undefined}
      className={cn(blocked !== null && "tw-cursor-not-allowed", className)}
      onClick={blocked === null ? onRevoke : undefined}
    >
      <Undo2 className="tw-size-3" />
      {label}
    </Button>
  );
  if (blocked === null) return button;
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side={tooltipSide}>{blocked}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

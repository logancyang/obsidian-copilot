import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";
import React, { useState } from "react";

interface TooltipProps {
  content: React.ReactNode;
  children?: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
  contentClassName?: string;
  buttonClassName?: string;
}

/**
 * A versatile tooltip component that works on both desktop and mobile devices.
 * On desktop, it shows on hover. On mobile, it shows on click.
 *
 * Can be used in two modes:
 * 1. Help mode (default): Shows a help icon with tooltip
 * 2. Wrapper mode (with children): Wraps any component with tooltip functionality
 */
export const HelpTooltip: React.FC<TooltipProps> = ({
  content,
  children,
  side = "bottom",
  delayDuration = 0,
  contentClassName,
  buttonClassName,
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip open={showTooltip}>
        <TooltipTrigger asChild>
          {children ? (
            <div
              onClick={() => setShowTooltip(!showTooltip)}
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
              className="tw-cursor-pointer"
            >
              {children}
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowTooltip(!showTooltip)}
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
              className={`tw-inline-flex tw-size-6 tw-items-center tw-justify-center tw-p-0 hover:tw-bg-transparent hover:tw-text-normal ${buttonClassName || ""}`}
            >
              <HelpCircle className="tw-size-4" />
            </Button>
          )}
        </TooltipTrigger>
        <TooltipContent side={side} className={contentClassName}>
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";
import React, { useState } from "react";
import { Platform } from "obsidian";

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
  const isMobile = Platform.isMobile;
  const [showTooltip, setShowTooltip] = useState(false);
  const isClickingRef = React.useRef(false);

  const handleTouchStart = () => {
    if (isMobile) {
      isClickingRef.current = true;
    }
  };

  const handleClick = () => {
    if (isMobile) {
      setShowTooltip(!showTooltip);
      // Reset the flag after a brief delay
      setTimeout(() => {
        isClickingRef.current = false;
      }, 100);
    }
  };

  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip
        open={showTooltip}
        onOpenChange={(open) => {
          // Ignore onOpenChange events on mobile when we're handling a click
          if (isMobile && isClickingRef.current) {
            return;
          }
          setShowTooltip(open);
        }}
      >
        <TooltipTrigger asChild>
          {children ? (
            <div
              onClick={handleClick}
              onTouchStart={handleTouchStart}
              className="tw-cursor-pointer"
            >
              {children}
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClick}
              onTouchStart={handleTouchStart}
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

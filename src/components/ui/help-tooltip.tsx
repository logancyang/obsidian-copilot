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
      window.setTimeout(() => {
        isClickingRef.current = false;
      }, 100);
    }
  };

  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip
        open={showTooltip}
        onOpenChange={(open) => {
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

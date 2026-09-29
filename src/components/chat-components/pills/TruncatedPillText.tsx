import React, { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface TruncatedPillTextProps {
  content: string;
  openBracket: string;
  closeBracket: string;
  className?: string;
  maxWidth?: string;
  tooltipContent?: React.ReactNode;
}

export function TruncatedPillText({
  content,
  openBracket,
  closeBracket,
  className,
  maxWidth = "tw-max-w-40",
  tooltipContent,
}: TruncatedPillTextProps): JSX.Element {
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState<boolean>(false);

  const onOpenChange = (isOpen: boolean): void => {
    const isTruncated = textRef.current
      ? textRef.current.offsetWidth < textRef.current.scrollWidth
      : false;
    setOpen(isOpen && isTruncated);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip open={open} onOpenChange={onOpenChange}>
        <TooltipTrigger asChild>
          <span className={cn("tw-inline-flex tw-items-center", maxWidth, className)}>
            <span className="tw-shrink-0">{openBracket}</span>
            <span ref={textRef} className="tw-min-w-0 tw-truncate">
              {content}
            </span>
            <span className="tw-shrink-0">{closeBracket}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="tw-max-w-64 tw-text-wrap tw-break-words">
          {tooltipContent || `${openBracket}${content}${closeBracket}`}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

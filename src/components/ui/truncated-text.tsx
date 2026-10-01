import React from "react";
import { TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type PropsWithChildren, useRef, useState } from "react";

const TOLERANCE = 2;
function isEllipsesActive(textRef: React.MutableRefObject<HTMLDivElement | null>): boolean {
  return (
    (textRef.current && textRef.current?.offsetWidth + TOLERANCE < textRef.current?.scrollWidth) ??
    false
  );
}

type Props = {
  className?: string;

  tooltipContent?: React.ReactNode;

  alwaysShowTooltip?: boolean;
} & React.HTMLAttributes<HTMLDivElement>;

export const TruncatedText = ({
  children,
  className,
  tooltipContent,
  alwaysShowTooltip = false,
  ...props
}: PropsWithChildren<Props>) => {
  const textRef = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState<boolean>(false);

  const onOpenChange = (isOpen: boolean): void => {
    setOpen(isOpen && (alwaysShowTooltip || isEllipsesActive(textRef)));
  };

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip open={open} onOpenChange={onOpenChange}>
        <TooltipTrigger asChild>
          <div
            {...props}
            ref={textRef}
            className={cn("tw-max-w-full tw-truncate tw-text-normal", className)}
            data-testid="truncatedText"
          >
            {children}
          </div>
        </TooltipTrigger>
        <TooltipContent className="tw-max-w-64 tw-text-wrap tw-break-words">
          {tooltipContent ?? children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

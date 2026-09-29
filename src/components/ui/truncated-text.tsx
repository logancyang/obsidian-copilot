import React from "react";
import { TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type PropsWithChildren, useRef, useState } from "react";

const TOLERANCE = 2;
function isEllipsesActive(
  textRef: React.MutableRefObject<HTMLDivElement | null>,
  lineClamp?: number
): boolean {
  if (lineClamp && lineClamp > 1) {
    return textRef.current ? textRef.current.offsetHeight < textRef.current.scrollHeight : false;
  }
  return (
    (textRef.current && textRef.current?.offsetWidth + TOLERANCE < textRef.current?.scrollWidth) ??
    false
  );
}

function getLineClampClass(lineClamp: number): string {
  switch (lineClamp) {
    case 2:
      return "tw-line-clamp-2";
    case 3:
      return "tw-line-clamp-3";
    default:
      return "";
  }
}

type Props = {
  className?: string;

  lineClamp?: number;

  tooltipContent?: React.ReactNode;

  alwaysShowTooltip?: boolean;
} & React.HTMLAttributes<HTMLDivElement>;

export const TruncatedText = ({
  children,
  className,
  lineClamp,
  tooltipContent,
  alwaysShowTooltip = false,
  ...props
}: PropsWithChildren<Props>) => {
  const textRef = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState<boolean>(false);

  const onOpenChange = (isOpen: boolean): void => {
    setOpen(isOpen && (alwaysShowTooltip || isEllipsesActive(textRef, lineClamp)));
  };

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip open={open} onOpenChange={onOpenChange}>
        <TooltipTrigger asChild>
          <div
            {...props}
            ref={textRef}
            className={cn(
              "tw-max-w-full tw-text-normal",
              (!lineClamp || lineClamp <= 1) && "tw-truncate",
              lineClamp && getLineClampClass(lineClamp),
              className
            )}
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

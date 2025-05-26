import React from "react";
import { TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type PropsWithChildren, useRef, useState } from "react";

const TOLERANCE = 2;
// detects text-overflow ellipses being used
// ref: https://stackoverflow.com/questions/7738117/html-text-overflow-ellipsis-detection
export function isEllipsesActive(
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

  /**
   * Clamp the text to a specific number of lines.
   * When set to a number >1, the text will be truncated to the specified number
   * of lines. Otherwise, the text will be truncated based on the width of the
   * container.
   */
  lineClamp?: number;

  /**
   * Content to show in tooltip when the text is truncated. If not provided,
   * the children will be used.
   */
  tooltipContent?: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>;

/**
 * Displays the overflowed text in a popover when there is no enough size to
 * to display the full text. The tooltip will be shown on hover only when the
 * text is cut off.
 *
 * Note: If the size of TruncatedText is set to `w-full`, the parent container
 * must have a fixed width and set `overflow: hidden`.
 */
export const TruncatedText = ({
  children,
  className,
  lineClamp,
  tooltipContent,
  ...props
}: PropsWithChildren<Props>) => {
  const textRef = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState<boolean>(false);

  const onOpenChange = (isOpen: boolean): void => {
    // only render the tooltip on hover if the text overflows
    setOpen(isOpen && isEllipsesActive(textRef, lineClamp));
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

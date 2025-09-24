import React from "react";
import { cn } from "@/lib/utils";

interface TruncatedPillTextProps {
  content: string;
  openBracket: string;
  closeBracket: string;
  className?: string;
  maxWidth?: string;
}

/**
 * Component that truncates text content in the middle while preserving opening and closing brackets.
 * Shows ellipsis in the middle when content is too long, ensuring brackets are always visible.
 *
 * @example
 * // Short text: [[Note Name]]
 * // Long text:  [[Very long note na...]]
 */
export function TruncatedPillText({
  content,
  openBracket,
  closeBracket,
  className,
  maxWidth = "tw-max-w-40",
}: TruncatedPillTextProps): JSX.Element {
  return (
    <span className={cn("tw-inline-flex tw-items-center", maxWidth, className)}>
      <span className="tw-shrink-0">{openBracket}</span>
      <span className="tw-min-w-0 tw-truncate">{content}</span>
      <span className="tw-shrink-0">{closeBracket}</span>
    </span>
  );
}

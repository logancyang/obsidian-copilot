/**
 * ContextRow - Layout for @ button and context badges
 *
 * Provides a consistent layout with a trigger button on the left
 * and a flex-wrap area for context badges (notes, URLs, etc.) on the right.
 */

import React from "react";
import { cn } from "@/lib/utils";

interface ContextRowProps {
  /** The trigger button (e.g., @ button with popover) */
  triggerButton: React.ReactNode;
  /** Context badges to display */
  children?: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
}

export function ContextRow({ triggerButton, children, className }: ContextRowProps) {
  return (
    <div className={cn("tw-flex tw-w-full tw-items-start tw-gap-1", className)}>
      <div className="tw-flex tw-h-full tw-items-start">{triggerButton}</div>
      <div className="tw-flex tw-flex-1 tw-flex-wrap tw-gap-1">{children}</div>
    </div>
  );
}

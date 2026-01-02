/**
 * InputToolbar - Bottom toolbar for chat input areas
 *
 * Provides a consistent layout with left and right sections
 * for model selectors, tool buttons, send buttons, etc.
 */

import React from "react";
import { cn } from "@/lib/utils";

interface InputToolbarProps {
  /** Content for the left section (e.g., model selector, loading indicator) */
  left?: React.ReactNode;
  /** Content for the right section (e.g., tool buttons, send button) */
  right?: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
}

export function InputToolbar({ left, right, className }: InputToolbarProps) {
  return (
    <div className={cn("tw-flex tw-h-6 tw-justify-between tw-gap-1 tw-px-1", className)}>
      <div className="tw-min-w-0 tw-flex-1">{left}</div>
      <div className="tw-flex tw-items-center tw-gap-1">{right}</div>
    </div>
  );
}

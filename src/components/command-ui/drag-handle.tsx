import * as React from "react";
import { cn } from "@/lib/utils";

interface DragHandleProps {
  onMouseDown?: (e: React.MouseEvent) => void;
  className?: string;
}

/**
 * A visual drag handle indicator for the modal.
 * Shows a centered bar that users can drag to reposition the modal.
 * Styled to match QuickAskPanel's drag handle.
 */
export function DragHandle({ onMouseDown, className }: DragHandleProps) {
  return (
    <div
      className={cn(
        "tw-flex tw-h-4 tw-items-center tw-justify-center",
        "tw-cursor-grab active:tw-cursor-grabbing",
        "hover:tw-bg-[color-mix(in_srgb,var(--background-modifier-hover)_20%,transparent)]",
        className
      )}
      onMouseDown={onMouseDown}
    >
      <div className="tw-h-[5px] tw-w-16 tw-rounded-sm tw-bg-[color-mix(in_srgb,var(--text-muted)_40%,transparent)] hover:tw-bg-[color-mix(in_srgb,var(--text-muted)_65%,transparent)]" />
    </div>
  );
}

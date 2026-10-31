import * as React from "react";
import { cn } from "@/lib/utils";

interface DragHandleProps {
  onPointerDown?: (e: React.PointerEvent) => void;
  className?: string;
}

export function DragHandle({ onPointerDown, className }: DragHandleProps) {
  return (
    <div
      className={cn(
        "tw-flex tw-h-4 tw-items-center tw-justify-center",
        "tw-cursor-grab tw-touch-none active:tw-cursor-grabbing",
        "hover:tw-bg-[color-mix(in_srgb,var(--background-modifier-hover)_20%,transparent)]",
        className
      )}
      onPointerDown={onPointerDown}
    >
      <div className="tw-h-[5px] tw-w-16 tw-rounded-sm tw-bg-[color-mix(in_srgb,var(--text-muted)_40%,transparent)] hover:tw-bg-[color-mix(in_srgb,var(--text-muted)_65%,transparent)]" />
    </div>
  );
}

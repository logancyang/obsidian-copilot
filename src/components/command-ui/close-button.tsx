import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface CloseButtonProps {
  onClose: () => void;
  className?: string;
}

/**
 * Close button positioned in the top-right corner of the modal.
 * Styled to match QuickAskPanel's close button using Button ghost2 variant.
 */
export function CloseButton({ onClose, className }: CloseButtonProps) {
  return (
    <Button
      className={cn("tw-absolute tw-right-2 tw-top-1 tw-rounded tw-p-1 tw-text-normal", className)}
      variant="ghost2"
      onClick={onClose}
      title="Close"
      aria-label="Close"
    >
      <X className="tw-size-4" />
    </Button>
  );
}

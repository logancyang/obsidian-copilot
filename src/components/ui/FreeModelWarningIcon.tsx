import { cn } from "@/lib/utils";
import { FREE_MODEL_PRIVACY_WARNING } from "@/components/ui/freeModelWarning";
import { AlertTriangle } from "lucide-react";
import React from "react";

/**
 * Small amber warning icon shown beside opencode Zen (free third-party) models.
 * The tooltip is a plain `title` attribute rather than the Radix tooltip: the
 * Radix variant's portal/`aria-label` path triggers an Obsidian hover error
 * (`isShown is not a function`) inside the settings panel, and a native title
 * renders fine everywhere (settings, picker popover, popout windows).
 */
export function FreeModelWarningIcon({ className }: { className?: string }) {
  return (
    <span
      title={FREE_MODEL_PRIVACY_WARNING}
      // Stop the click from reaching the surrounding row (selecting the model).
      onClick={(e) => e.stopPropagation()}
      className={cn("tw-flex tw-shrink-0 tw-items-center tw-text-warning", className)}
    >
      <AlertTriangle className="tw-size-3.5" />
    </span>
  );
}

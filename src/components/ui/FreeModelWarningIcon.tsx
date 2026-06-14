import { cn } from "@/lib/utils";
import { FREE_MODEL_PRIVACY_WARNING } from "@/components/ui/freeModelWarning";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { AlertTriangle } from "lucide-react";
import React from "react";

/**
 * Small amber warning icon shown beside opencode Zen (free third-party) models.
 *
 * Uses the Radix `HelpTooltip` with `delayDuration={0}` so it appears instantly
 * on hover (the browser `title` attribute has a fixed ~1s delay). Note: no
 * `aria-label` on the icon — that attribute makes Obsidian attach its own native
 * tooltip, which throws `isShown is not a function` here; the tooltip text
 * already conveys the meaning.
 */
export function FreeModelWarningIcon({ className }: { className?: string }) {
  return (
    <span
      // Stop the click from reaching the surrounding row (selecting the model).
      onClick={(e) => e.stopPropagation()}
      className={cn("tw-flex tw-shrink-0 tw-items-center tw-text-warning", className)}
    >
      <HelpTooltip content={FREE_MODEL_PRIVACY_WARNING} side="top" delayDuration={0}>
        <AlertTriangle className="tw-size-3.5" />
      </HelpTooltip>
    </span>
  );
}

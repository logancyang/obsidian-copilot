import { cn } from "@/lib/utils";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Lock } from "lucide-react";
import React from "react";

const LICENSE_REQUIRED = "Copilot license required";

/**
 * Small lock icon shown beside a Copilot model a user cannot run yet, so the
 * lineup is discoverable before anyone pays for it. The row it sits on is
 * already greyed and non-selectable; this is what says why.
 *
 * Parallels {@link FreeModelWarningIcon}: same Radix `HelpTooltip` with
 * `delayDuration={0}` for instant hover, and no `aria-label` (that makes
 * Obsidian attach its own native tooltip, which throws `isShown is not a
 * function` here — the tooltip text already conveys the meaning). Muted rather
 * than amber: a locked model is an offer, not a warning.
 */
export function LicenseRequiredIcon({ className }: { className?: string }) {
  return (
    <span
      // Stop the click from reaching the surrounding row.
      onClick={(e) => e.stopPropagation()}
      className={cn(
        // The lock always sits on a row that is disabled — and a disabled
        // `DropdownMenuItem` sets `pointer-events: none`, which every descendant
        // inherits. Without this reset the tooltip can never be hovered, leaving
        // the row greyed with nothing to say why.
        "tw-pointer-events-auto tw-flex tw-shrink-0 tw-items-center tw-text-muted",
        className
      )}
    >
      <HelpTooltip content={LICENSE_REQUIRED} side="top" delayDuration={0}>
        <Lock className="tw-size-3.5" />
      </HelpTooltip>
    </span>
  );
}

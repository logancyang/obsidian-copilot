import { cn } from "@/lib/utils";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Lock } from "lucide-react";
import React from "react";

const LICENSE_REQUIRED = "Copilot license required";

/**
 * Small lock icon shown beside a Copilot model a user cannot run yet, so the
 * lineup is discoverable before anyone pays for it. The row it sits on is
 * unavailable for selection; activating the row opens pricing.
 *
 * Parallels {@link FreeModelWarningIcon}: same Radix `HelpTooltip` with
 * `delayDuration={0}` for instant hover, and no `aria-label` (that makes
 * Obsidian attach its own native tooltip, which throws `isShown is not a
 * function` here). Muted rather than amber: a locked model is an offer, not a
 * warning.
 */
export function LicenseRequiredIcon({ className }: { className?: string }) {
  return (
    <span
      // Let clicks reach the row's pricing action, including taps on the tooltip.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/476
      className={cn("tw-flex tw-shrink-0 tw-items-center tw-text-muted", className)}
    >
      <HelpTooltip content={LICENSE_REQUIRED} side="top" delayDuration={0}>
        <Lock className="tw-size-3.5" />
      </HelpTooltip>
      {/* Include the license requirement in the row's accessible name. */}
      <span className="tw-sr-only">{LICENSE_REQUIRED}</span>
    </span>
  );
}

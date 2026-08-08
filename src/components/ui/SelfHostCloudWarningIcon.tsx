import { cn } from "@/lib/utils";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { AlertTriangle } from "lucide-react";
import React from "react";

const SELF_HOST_CLOUD_WARNING =
  "Bypasses Self-Host Mode — sends prompts to the cloud. Pick a self-hosted option to keep everything on your machine.";

/**
 * Small amber warning icon shown beside cloud providers / cloud agents while
 * Self-Host Mode is on. Self-Host Mode is a presentation label — cloud options
 * stay visible and selectable, so this marks them (rather than hiding them) and
 * leaves the choice to the user.
 *
 * Parallels {@link FreeModelWarningIcon}: same Radix `HelpTooltip` with
 * `delayDuration={0}` for instant hover, and no `aria-label` (that makes
 * Obsidian attach its own native tooltip, which throws `isShown is not a
 * function` here — the tooltip text already conveys the meaning).
 *
 * `stopPropagation` (default true) keeps a click on the icon from reaching the
 * surrounding dropdown ROW (which would select that model). Set it false when the
 * icon sits on a picker's closed TRIGGER, where the click SHOULD fall through to
 * open the menu — otherwise the icon becomes a dead zone over the button.
 */
export function SelfHostCloudWarningIcon({
  className,
  stopPropagation = true,
}: {
  className?: string;
  stopPropagation?: boolean;
}) {
  return (
    <span
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
      className={cn("tw-flex tw-shrink-0 tw-items-center tw-text-warning", className)}
    >
      <HelpTooltip content={SELF_HOST_CLOUD_WARNING} side="top" delayDuration={0}>
        <AlertTriangle className="tw-size-3.5" />
      </HelpTooltip>
    </span>
  );
}

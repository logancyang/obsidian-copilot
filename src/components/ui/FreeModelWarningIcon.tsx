import { cn } from "@/lib/utils";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { AlertTriangle } from "lucide-react";
import React from "react";

const FREE_MODEL_PRIVACY_WARNING =
  "Free model. The provider may log or train on your prompts. Review their privacy terms before sending sensitive content.";

export function FreeModelWarningIcon({ className }: { className?: string }) {
  return (
    <span
      onClick={(e) => e.stopPropagation()}
      className={cn("tw-flex tw-shrink-0 tw-items-center tw-text-warning", className)}
    >
      <HelpTooltip content={FREE_MODEL_PRIVACY_WARNING} side="top" delayDuration={0}>
        <AlertTriangle className="tw-size-3.5" />
      </HelpTooltip>
    </span>
  );
}

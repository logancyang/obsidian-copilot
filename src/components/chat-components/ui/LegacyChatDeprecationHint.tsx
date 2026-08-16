import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CircleAlert } from "lucide-react";
import React from "react";

export interface LegacyChatDeprecationHintProps {
  onOpenAgent: () => void;
}

/** Directs legacy V3 Chat users to supported models in Agent. */
export function LegacyChatDeprecationHint({ onOpenAgent }: LegacyChatDeprecationHintProps) {
  return (
    <div className="tw-flex tw-min-w-0 tw-px-1">
      <Button
        variant="ghost2"
        size="fit"
        className={cn(
          "tw-flex tw-min-w-0 tw-items-center tw-gap-1 tw-text-ui-smaller tw-text-muted",
          "hover:tw-text-normal"
        )}
        title="Open Agent"
        onClick={onOpenAgent}
      >
        <CircleAlert className="tw-size-3 tw-shrink-0" aria-hidden="true" />
        <span className="tw-truncate">
          V3 Chat will be deprecated soon. Use Agent with opencode for BYOK and Copilot-hosted
          models.
        </span>
      </Button>
    </div>
  );
}

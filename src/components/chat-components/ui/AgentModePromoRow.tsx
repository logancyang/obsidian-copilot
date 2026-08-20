import { Button } from "@/components/ui/button";
import { CopilotBrandIcon } from "@/components/ui/CopilotBrandIcon";
import { cn } from "@/lib/utils";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { X } from "lucide-react";
import React from "react";

export interface AgentModePromoRowProps {
  /**
   * Whether the user already dismissed the row. The parent owns the persisted
   * `agentMode.quickChatPromoDismissed` flag; this component holds no state.
   */
  dismissed: boolean;
  onOpenAgent: () => void;
  onDismiss: () => void;
}

/** Announces Agent mode from the Quick Chat composer footer, dismissable for good. */
export function AgentModePromoRow({ dismissed, onOpenAgent, onDismiss }: AgentModePromoRowProps) {
  // Agent is unavailable on real and emulated mobile, so the promotion stays desktop-only.
  // https://github.com/logancyang/obsidian-copilot-preview/issues/323
  if (!isDesktopRuntime() || dismissed) return null;

  return (
    <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-1 tw-px-1">
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
        <CopilotBrandIcon className="tw-size-3" />
        <span className="tw-truncate">
          Agent mode is here: more capable models, tools, and skills.
        </span>
      </Button>
      <Button
        variant="ghost2"
        size="fit"
        className="tw-text-muted hover:tw-text-normal"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <X className="tw-size-3 tw-shrink-0" />
      </Button>
    </div>
  );
}

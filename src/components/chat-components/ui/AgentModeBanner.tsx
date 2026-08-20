import { CopilotBrandIcon } from "@/components/ui/CopilotBrandIcon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import React from "react";

export interface AgentModeBannerProps {
  onOpenAgent: () => void;
}

/**
 * Announces Agent mode to Quick Chat users from the top of the chat column,
 * styled to match its slot sibling `NewVersionBanner`. The whole row is the
 * click target that opens the Agent view.
 */
export function AgentModeBanner({ onOpenAgent }: AgentModeBannerProps) {
  // Agent is unavailable on real and emulated mobile, so this announcement must stay desktop-only.
  // https://github.com/logancyang/obsidian-copilot-preview/issues/323
  if (!isDesktopRuntime()) return null;

  return (
    <Button
      variant="ghost2"
      size="fit"
      className={cn(
        "tw-mb-1 tw-w-full tw-shrink-0 tw-justify-start tw-gap-2 tw-rounded-md tw-border",
        "tw-border-solid tw-border-border tw-p-2 tw-pl-3 tw-text-left tw-text-muted",
        // Wrap instead of truncating: a narrow sidebar must still show the whole sentence.
        "tw-whitespace-normal hover:tw-text-normal"
      )}
      title="Open Agent"
      onClick={onOpenAgent}
    >
      <CopilotBrandIcon className="tw-size-4 tw-text-accent" />
      <span>New: Agent mode. More capable models, tools, and skills.</span>
    </Button>
  );
}

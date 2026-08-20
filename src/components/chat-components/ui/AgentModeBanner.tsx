import { CopilotBrandIcon } from "@/components/ui/CopilotBrandIcon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import React from "react";

export interface AgentModeBannerProps {
  onOpenAgent: () => void;
}

/**
 * Announces Agent mode at the top of the chat column. The whole card is the
 * click target that opens the Agent view. `Chat` mounts it only while the chat
 * has nothing to show, so it introduces Agent mode on an empty chat and then
 * stays out of the way of a conversation.
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
        "tw-mb-2 tw-w-full tw-shrink-0 tw-cursor-pointer tw-justify-start tw-gap-3 tw-rounded-md",
        "tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-3 tw-text-left",
        "tw-text-ui-small tw-text-normal hover:tw-bg-interactive-hover hover:tw-text-normal",
        // Wrap instead of truncating: a narrow sidebar must still show the whole sentence.
        "tw-whitespace-normal"
      )}
      title="Open Agent"
      onClick={onOpenAgent}
    >
      <CopilotBrandIcon className="tw-size-4 tw-text-accent" />
      <span>New: Agent mode. More capable models, tools, and skills.</span>
    </Button>
  );
}

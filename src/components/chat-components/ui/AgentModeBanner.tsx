import { CopilotBrandIcon } from "@/components/ui/CopilotBrandIcon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import React from "react";

export interface AgentModeBannerProps {
  onOpenAgent: () => void;
}

/**
 * Invites Quick Chat users to Copilot Agent Chat. The whole card is the click
 * target that opens the Agent view. `Chat` mounts it only while the chat has
 * nothing to show, so it fills the empty view with one offer and then stays out
 * of the way of a conversation.
 */
export function AgentModeBanner({ onOpenAgent }: AgentModeBannerProps) {
  // Agent is unavailable on real and emulated mobile, so this invitation must stay desktop-only.
  // https://github.com/logancyang/obsidian-copilot-preview/issues/323
  if (!isDesktopRuntime()) return null;

  return (
    <Button
      variant="ghost2"
      size="fit"
      className={cn(
        // A share of the empty column rather than a line in it: at a line's
        // height the card reads as a stray notice in a tall pane.
        "tw-h-auto tw-min-h-[30%] tw-w-full tw-shrink-0 tw-cursor-pointer",
        "tw-flex-col tw-justify-center tw-gap-4 tw-rounded-md tw-border tw-border-solid",
        "tw-border-border tw-bg-secondary tw-p-6 tw-text-center tw-text-normal",
        "hover:tw-bg-interactive-hover hover:tw-text-normal",
        // Wrap instead of truncating: a narrow sidebar must still show the whole sentence.
        "tw-whitespace-normal"
      )}
      title="Open Copilot Agent Chat"
      onClick={onOpenAgent}
    >
      <CopilotBrandIcon className="tw-size-12 tw-text-accent" />
      {/* One size throughout; weight and colour carry the hierarchy. */}
      <span className="tw-flex tw-flex-col tw-gap-2 tw-text-ui-larger tw-leading-tight">
        <span className="tw-font-semibold">Switch to Copilot Agent Chat</span>
        <span className="tw-text-muted">for a more capable agent experience</span>
      </span>
    </Button>
  );
}

import { CopilotBrandIcon } from "@/components/ui/CopilotBrandIcon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import React from "react";

export interface AgentModeBannerProps {
  onOpenAgent: () => void;
}

export function AgentModeBanner({ onOpenAgent }: AgentModeBannerProps) {
  // Agent is unavailable on real and emulated mobile, so this invitation must stay desktop-only.
  // https://github.com/logancyang/obsidian-copilot-preview/issues/323
  if (!isDesktopRuntime()) return null;

  return (
    <Button
      variant="ghost2"
      size="fit"
      className={cn(
        "tw-h-auto tw-min-h-[30%] tw-w-full tw-shrink-0 tw-cursor-pointer",
        "tw-flex-col tw-items-start tw-justify-center tw-rounded-md tw-border tw-border-solid",
        "tw-border-border tw-bg-secondary tw-p-6 tw-text-left tw-text-normal",
        "hover:tw-bg-interactive-hover hover:tw-text-normal",
        "tw-whitespace-normal"
      )}
      title="Open Copilot Agent Chat"
      onClick={onOpenAgent}
    >
      <span className="tw-flex tw-w-full tw-flex-col tw-gap-2">
        <span className="tw-flex tw-items-center tw-gap-2">
          <CopilotBrandIcon className="tw-size-6 tw-shrink-0 tw-text-accent" />
          <span className="tw-text-ui-larger tw-font-semibold tw-leading-tight">
            Open Copilot Agent Chat
          </span>
        </span>
        <span className="tw-text-ui-smaller tw-leading-normal tw-text-muted">
          Find and edit notes with an agent.
        </span>
      </span>
    </Button>
  );
}

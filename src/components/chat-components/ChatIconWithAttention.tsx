import React from "react";
import { cn } from "@/lib/utils";

interface ChatIconWithAttentionProps {
  icon: React.ComponentType<{ className?: string }>;
  needsAttention?: boolean;
  isSessionLive?: boolean;
  iconClassName?: string;
}

export const ChatIconWithAttention: React.FC<ChatIconWithAttentionProps> = ({
  icon: Icon,
  needsAttention,
  isSessionLive,
  iconClassName,
}) => (
  // The full icon owns the tooltip because the blue dot is too small to target reliably.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/429
  <span
    className="tw-relative tw-inline-flex tw-shrink-0 tw-items-center tw-justify-center"
    title={isSessionLive ? "Session is running" : undefined}
  >
    <Icon className={iconClassName} />
    {(needsAttention || isSessionLive) && (
      <span
        aria-label={isSessionLive ? "Session live" : undefined}
        aria-hidden={!isSessionLive}
        className={cn(
          "tw-absolute -tw-bottom-0.5 -tw-right-0.5 tw-size-1.5 tw-rounded-full tw-ring-1 tw-ring-[var(--background-primary)]",
          needsAttention ? "tw-bg-interactive-accent" : "tw-bg-current tw-text-loading"
        )}
      />
    )}
  </span>
);

import React from "react";
import { cn } from "@/lib/utils";

interface ChatIconWithAttentionProps {
  /** Leading glyph (a lucide icon or backend brand icon). */
  icon: React.ComponentType<{ className?: string }>;
  /** Overlay the accent dot — set when a live session for this chat needs attention. */
  needsAttention?: boolean;
  /** Show that the chat still owns a backend session. */
  isSessionLive?: boolean;
  /** Class for the glyph itself (size + colour); the dot positions against it. */
  iconClassName?: string;
}

/**
 * Chat-row icon with the same "needs attention" accent dot the agent tab strip's
 * `BrandIcon` paints, so a backgrounded session that finished / paused for
 * permission remains visible in the history list. A live session uses the same
 * bottom-right position with the loading color when no attention state takes priority.
 */
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

import React from "react";
import { OpenSessionIndicator } from "@/components/chat-components/ui/OpenSessionControls";
import { cn } from "@/lib/utils";

interface ChatIconWithAttentionProps {
  /** Leading glyph (a lucide icon or backend brand icon). */
  icon: React.ComponentType<{ className?: string }>;
  /** Overlay the accent dot — set when a live session for this chat needs attention. */
  needsAttention?: boolean;
  isSessionOpen?: boolean;
  /** Class for the glyph itself (size + colour); the dot positions against it. */
  iconClassName?: string;
}

/**
 * Chat-row icon with the same "needs attention" accent dot the agent tab strip's
 * `BrandIcon` paints, so a backgrounded session that finished / paused for
 * permission remains visible in the history list. The wrapper owns
 * positioning; callers size the glyph via `iconClassName` (rows differ: `tw-size-3`
 * in the popover, `tw-size-4` inline). Open sessions reserve the top-right
 * corner for their status; attention stays visible at the bottom-right.
 */
export const ChatIconWithAttention: React.FC<ChatIconWithAttentionProps> = ({
  icon: Icon,
  needsAttention,
  isSessionOpen,
  iconClassName,
}) => (
  <span className="tw-relative tw-inline-flex tw-shrink-0 tw-items-center tw-justify-center">
    <Icon className={iconClassName} />
    {/* Idle backends still hold resources: https://github.com/Brevilabs/obsidian-copilot-private/issues/429 */}
    {isSessionOpen && <OpenSessionIndicator />}
    {needsAttention && (
      <span
        aria-hidden
        className={cn(
          "tw-absolute -tw-right-0.5 tw-size-1.5 tw-rounded-full tw-ring-1 tw-ring-[var(--background-primary)]",
          "tw-bg-interactive-accent",
          isSessionOpen ? "-tw-bottom-0.5" : "-tw-top-0.5"
        )}
      />
    )}
  </span>
);

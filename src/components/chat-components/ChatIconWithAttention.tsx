import React from "react";
import { cn } from "@/lib/utils";

interface ChatIconWithAttentionProps {
  /** Leading glyph (a lucide icon or backend brand icon). */
  icon: React.ComponentType<{ className?: string }>;
  /** Overlay the accent dot — set when a live session for this chat needs attention. */
  needsAttention?: boolean;
  /** Class for the glyph itself (size + colour); the dot positions against it. */
  iconClassName?: string;
}

/**
 * Chat-row icon with the same "needs attention" accent dot the agent tab strip's
 * `BrandIcon` paints, so a backgrounded session that finished / paused for
 * permission reads identically in the history list and on its tab. Accent-only
 * (the history list has no spinner / error-dot states). The wrapper owns
 * positioning; callers size the glyph via `iconClassName` (rows differ: `tw-size-3`
 * in the popover, `tw-size-4` inline).
 */
export const ChatIconWithAttention: React.FC<ChatIconWithAttentionProps> = ({
  icon: Icon,
  needsAttention,
  iconClassName,
}) => (
  <span className="tw-relative tw-inline-flex tw-shrink-0 tw-items-center tw-justify-center">
    <Icon className={iconClassName} />
    {needsAttention && (
      <span
        aria-hidden
        className={cn(
          "tw-absolute -tw-right-0.5 -tw-top-0.5 tw-size-1.5 tw-rounded-full tw-ring-1 tw-ring-[var(--background-primary)]",
          "tw-bg-interactive-accent"
        )}
      />
    )}
  </span>
);

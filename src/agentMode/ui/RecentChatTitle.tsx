import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import React from "react";

export interface RecentChatProjectBadgeProps {
  name: string;
}

/** Compact project marker that keeps long names from taking over a chat row. */
export function RecentChatProjectBadge({ name }: RecentChatProjectBadgeProps): React.ReactElement {
  return (
    <Badge
      variant="secondary"
      aria-label={`Project: ${name}`}
      title={name}
      className="tw-min-w-0 tw-max-w-24 tw-shrink-0 tw-px-1.5 tw-py-0 tw-font-normal tw-text-muted"
    >
      <span className="tw-truncate">{name}</span>
    </Badge>
  );
}

export interface RecentChatTitleProps {
  title: string;
  /**
   * Emoji of the agent this chat was held with, rendered before the title so a
   * DM is recognizable in the list (`designdocs/CUSTOM_AGENTS.md` §8). Omitted
   * for Copilot chats, which keep the plain title they always had.
   */
  agentIcon?: string;
  className?: string;
}

/** Conversation title that consumes the row space left by trailing metadata. */
export function RecentChatTitle({
  title,
  agentIcon,
  className,
}: RecentChatTitleProps): React.ReactElement {
  return (
    <span
      className={cn(
        "tw-block tw-min-w-0 tw-flex-1 tw-truncate tw-text-ui-small tw-text-normal",
        className
      )}
      title={title}
    >
      {agentIcon && (
        <span aria-hidden="true" className="tw-mr-1">
          {agentIcon}
        </span>
      )}
      {title}
    </span>
  );
}

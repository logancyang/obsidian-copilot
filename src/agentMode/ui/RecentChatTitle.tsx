import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import React from "react";
import { t } from "@/i18n";

export interface RecentChatProjectBadgeProps {
  name: string;
}

/** Compact project marker that keeps long names from taking over a chat row. */
export function RecentChatProjectBadge({ name }: RecentChatProjectBadgeProps): React.ReactElement {
  return (
    <Badge
      variant="secondary"
      aria-label={t("agentChat.recent.project", { project: name })}
      title={name}
      className="tw-min-w-0 tw-max-w-24 tw-shrink-0 tw-px-1.5 tw-py-0 tw-font-normal tw-text-muted"
    >
      <span className="tw-truncate">{name}</span>
    </Badge>
  );
}

export interface RecentChatTitleProps {
  title: string;
  className?: string;
}

/** Conversation title that consumes the row space left by trailing metadata. */
export function RecentChatTitle({ title, className }: RecentChatTitleProps): React.ReactElement {
  return (
    <span
      className={cn(
        "tw-block tw-min-w-0 tw-flex-1 tw-truncate tw-text-ui-small tw-text-normal",
        className
      )}
      title={title}
    >
      {title}
    </span>
  );
}

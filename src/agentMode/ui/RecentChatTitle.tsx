import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import React from "react";

export interface RecentChatProjectBadgeProps {
  name: string;
}

/** Secondary project context that wraps within the conversation text column. */
export function RecentChatProjectBadge({ name }: RecentChatProjectBadgeProps): React.ReactElement {
  return (
    <Badge
      variant="secondary"
      aria-label={`Project: ${name}`}
      title={name}
      className="tw-min-w-0 tw-max-w-full tw-self-start tw-px-1.5 tw-py-0 tw-font-normal tw-text-muted"
    >
      <span className="tw-whitespace-normal [overflow-wrap:anywhere]">{name}</span>
    </Badge>
  );
}

export interface RecentChatTitleProps {
  title: string;
  className?: string;
}

/** Full conversation title, wrapping so similar opening words do not hide the distinguishing text. */
export function RecentChatTitle({ title, className }: RecentChatTitleProps): React.ReactElement {
  return (
    <span
      className={cn(
        "tw-block tw-min-w-0 tw-whitespace-normal tw-text-ui-small tw-text-normal [overflow-wrap:anywhere]",
        className
      )}
      title={title}
    >
      {title}
    </span>
  );
}

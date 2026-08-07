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
  projectName?: string;
  className?: string;
}

/** Responsive chat identity that truncates the title and project name independently. */
export function RecentChatTitle({
  title,
  projectName,
  className,
}: RecentChatTitleProps): React.ReactElement {
  return (
    <div className={cn("tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-1.5", className)}>
      <span
        className="tw-block tw-min-w-0 tw-shrink tw-truncate tw-text-ui-small tw-text-normal"
        title={title}
      >
        {title}
      </span>
      {projectName && <RecentChatProjectBadge name={projectName} />}
    </div>
  );
}

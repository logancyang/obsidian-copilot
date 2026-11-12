import { AgentGlyph } from "@/components/ui/AgentGlyph";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import React from "react";

export interface RecentChatProjectBadgeProps {
  name: string;
}

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
  agentFace?: { name: string; avatarSrc: string | null };
  className?: string;
}

export function RecentChatTitle({
  title,
  agentFace,
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
      {agentFace && (
        <AgentGlyph
          name={agentFace.name}
          avatarSrc={agentFace.avatarSrc}
          className="tw-mr-1 tw-inline-flex tw-align-text-bottom"
        />
      )}
      {title}
    </span>
  );
}

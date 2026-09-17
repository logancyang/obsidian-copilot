import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BookOpen } from "lucide-react";
import React from "react";

export interface AgentMemoryNoticeLineProps {
  /** Agent that wrote the file, named in the line. */
  agentName: string;
  /** Open `MEMORY.md` so the user can read what was written about them. */
  onOpen: () => void;
  className?: string;
}

/**
 * The one quiet line a chat shows after its agent has updated its memory,
 * placed where the conversation ended.
 *
 * It says what happened and offers the file, and nothing more: an agent that
 * keeps notes on the user has to be inspectable, but a modal or a badge would
 * turn a background housekeeping step into something the user has to dismiss.
 * The agent is referred to by name rather than by a pronoun, because the user
 * named it and we do not know what it is. See `designdocs/CUSTOM_AGENTS.md` §5
 * ("Trust surface").
 */
export const AgentMemoryNoticeLine: React.FC<AgentMemoryNoticeLineProps> = ({
  agentName,
  onOpen,
  className,
}) => (
  <div className={cn("tw-w-full tw-px-3 tw-pb-2 tw-pt-1", className)}>
    <div className="tw-flex tw-items-center tw-gap-1.5 tw-pl-1 tw-text-ui-small tw-text-muted">
      <BookOpen className="tw-size-icon-xs tw-shrink-0" aria-hidden="true" />
      <span className="tw-min-w-0 tw-truncate">{agentName} updated their memory</span>
      <Button
        variant="ghost2"
        size="fit"
        onClick={onOpen}
        className="tw-text-ui-small tw-text-muted tw-underline hover:tw-text-normal"
      >
        Open
      </Button>
    </div>
  </div>
);

AgentMemoryNoticeLine.displayName = "AgentMemoryNoticeLine";

import type { QueuedAgentMessage } from "@/agentMode/session/AgentInputDraftStore";
import type { QueuedPrompt } from "@/agentMode/session/types";
import { Button } from "@/components/ui/button";
import { Clock, X } from "lucide-react";
import React from "react";

interface QueuedMessageListProps {
  delivering: readonly QueuedPrompt[];
  held: readonly QueuedAgentMessage[];
  onRemove: (id: string) => void;
}

interface QueuedMessageRowProps {
  message: QueuedPrompt;
  children: React.ReactNode;
}

const QueuedMessageRow: React.FC<QueuedMessageRowProps> = ({ message, children }) => {
  // Image-only turns need a visible queue label after the composer clears.
  // https://github.com/logancyang/obsidian-copilot/issues/2850
  const label =
    message.text ||
    (message.promptContent?.some((block) => block.type === "image")
      ? "Image attachment"
      : "Empty message");
  return (
    <div
      className="tw-flex tw-min-w-0 tw-items-center tw-gap-2 tw-rounded-md tw-bg-secondary-alt tw-px-2 tw-py-1 tw-text-ui-smaller"
      title={label}
    >
      <Clock className="tw-size-3 tw-shrink-0 tw-text-muted" />
      <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-whitespace-nowrap tw-text-normal">
        {label}
      </span>
      {children}
    </div>
  );
};

export const QueuedMessageList: React.FC<QueuedMessageListProps> = ({
  delivering,
  held,
  onRemove,
}) => {
  return (
    <div className="tw-flex tw-max-h-24 tw-flex-col tw-gap-1 tw-overflow-y-auto tw-px-2 tw-pb-1">
      {delivering.map((m) => (
        <QueuedMessageRow key={m.id} message={m}>
          <span className="tw-shrink-0 tw-text-muted">Queued</span>
        </QueuedMessageRow>
      ))}
      {held.length > 0 && (
        <div className="tw-px-1 tw-text-ui-smaller tw-text-muted">
          Sends when the agent finishes
        </div>
      )}
      {held.map((m) => (
        <QueuedMessageRow key={m.id} message={m}>
          <Button
            variant="ghost2"
            size="fit"
            className="tw-shrink-0 tw-text-muted hover:tw-text-error"
            onClick={() => onRemove(m.id)}
            aria-label="Remove queued message"
          >
            <X className="tw-size-3" />
          </Button>
        </QueuedMessageRow>
      ))}
    </div>
  );
};

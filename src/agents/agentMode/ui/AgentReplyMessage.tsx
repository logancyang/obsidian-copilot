import type { TurnFileChange } from "@/agentMode/session/types";
import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import { FilesChangedCard } from "@/agentMode/ui/FilesChangedCard";
import { useApp } from "@/context";
import React from "react";

export interface AgentReplyMessageProps {
  mention: string;
  name: string;
  reply: string;
  fileChanges?: TurnFileChange[];
  onOpenFileChange: (change: TurnFileChange) => void;
}

export const AgentReplyMessage: React.FC<AgentReplyMessageProps> = ({
  mention,
  name,
  reply,
  fileChanges,
  onOpenFileChange,
}) => {
  const app = useApp();
  return (
    <div className="tw-flex tw-flex-col tw-gap-1 tw-px-3 tw-pt-2" data-agent-relay={mention}>
      <div className="tw-text-sm tw-text-muted">
        {reply ? `${name}'s reply` : `${name} didn't reply`}
      </div>
      {reply ? (
        <div className="tw-select-text tw-break-words tw-border-0 tw-border-l tw-border-solid tw-border-border tw-pl-2">
          <AgentMarkdownText text={reply} app={app} />
        </div>
      ) : null}
      {fileChanges && fileChanges.length > 0 ? (
        <FilesChangedCard changes={fileChanges} onOpen={onOpenFileChange} />
      ) : null}
    </div>
  );
};

import type { TurnFileChange } from "@/agentMode/session/types";
import { FilesChangedCard } from "@/agentMode/ui/FilesChangedCard";
import type { AgentMention } from "@/agents/agentMentions";
import type { AgentReplyMarker } from "@/agents/agentReply";
import { AgentMessageCard } from "@/agents/agentMode/ui/AgentMessageCard";
import { useChatAgents } from "@/agents/ui/chatAgents";
import React from "react";

export interface AgentReplyMessageProps {
  marker: AgentReplyMarker;
  reply: string;
  run?: AgentMention;
  fileChanges?: TurnFileChange[];
  onOpenFileChange: (change: TurnFileChange) => void;
  children?: React.ReactNode;
}

const ENDED_WITHOUT_WORDS: Partial<Record<AgentMention["status"], string>> = {
  stopped: "stopped",
  didnt_finish: "didn't finish",
};

// A relay reads as a message from the asked agent, its question or its reply alike, on the same card as the ask; only a run that ended with nothing to say says how it ended. The files it changed stay below, since Revoke lives there.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/967
export const AgentReplyMessage: React.FC<AgentReplyMessageProps> = ({
  marker,
  reply,
  run,
  fileChanges,
  onOpenFileChange,
  children,
}) => {
  const agent = useChatAgents().find(({ slug }) => slug === marker.agent);
  const ended = reply || !run ? undefined : ENDED_WITHOUT_WORDS[run.status];
  return (
    <div className="tw-flex tw-flex-col tw-gap-1 tw-px-3 tw-pt-2">
      <AgentMessageCard
        before={ended ? undefined : "Message from"}
        name={marker.name}
        faceSrc={agent?.faceSrc}
        after={ended}
        run={{ runId: marker.mention }}
      />
      {children}
      {fileChanges && fileChanges.length > 0 ? (
        <FilesChangedCard changes={fileChanges} onOpen={onOpenFileChange} />
      ) : null}
    </div>
  );
};

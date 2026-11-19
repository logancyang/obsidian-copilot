import type { TurnFileChange } from "@/agentMode/session/types";
import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import { FilesChangedCard } from "@/agentMode/ui/FilesChangedCard";
import type { AgentMention } from "@/agents/agentMentions";
import { didntFinishReason } from "@/agents/agentMentionStatus";
import type { AgentReplyMarker } from "@/agents/agentReply";
import { AgentFace } from "@/agents/ui/AgentFace";
import { useChatAgents } from "@/agents/ui/chatAgents";
import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { Bot } from "lucide-react";
import React, { useState } from "react";

export interface AgentReplyMessageProps {
  marker: AgentReplyMarker;
  reply: string;
  run?: AgentMention;
  followedUp?: boolean;
  fileChanges?: TurnFileChange[];
  onOpenFileChange: (change: TurnFileChange) => void;
}

type FoldKind = "reply" | "question" | "didnt_finish";

const WAITING_OR_WORKING: ReadonlySet<AgentMention["status"]> = new Set([
  "working",
  "question",
  "permission",
]);

const FOLD_BAR: Record<FoldKind, string> = {
  reply: "tw-border-border",
  question: "tw-border-[color:var(--text-warning)]",
  didnt_finish: "tw-border-error",
};

// The relay that ends a run is its reply; any relay before it, or one whose run still works, waits or ended with Obsidian closed (which relays nothing), was the agent's question.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/947
function foldKind(run: AgentMention | undefined, followedUp: boolean): FoldKind {
  if (
    followedUp ||
    (run && (WAITING_OR_WORKING.has(run.status) || run.end?.kind === "obsidian_closed"))
  ) {
    return "question";
  }
  return run?.status === "didnt_finish" ? "didnt_finish" : "reply";
}

function foldLabel(kind: FoldKind, name: string, reply: string): string {
  if (kind === "question") return `${name}'s question`;
  if (kind === "didnt_finish") return `${name} didn't finish`;
  // An agent can end its turn without writing anything, and an empty fold would hide that it said nothing.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/947
  return reply ? `${name}'s reply` : `${name} didn't reply`;
}

// The asked agent's own words come back folded under its face and name, with the files it changed, and the chat's agent passes them on below; a run that didn't finish folds its reason with them.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/947
export const AgentReplyMessage: React.FC<AgentReplyMessageProps> = ({
  marker,
  reply,
  run,
  followedUp = false,
  fileChanges,
  onOpenFileChange,
}) => {
  const app = useApp();
  const agent = useChatAgents().find(({ slug }) => slug === marker.agent);
  const [open, setOpen] = useState(false);
  const kind = foldKind(run, followedUp);
  const reason = kind === "didnt_finish" && run ? didntFinishReason(run) : null;
  return (
    <div
      className="tw-flex tw-flex-col tw-gap-1 tw-px-3 tw-pt-2"
      data-agent-relay={kind === "question" ? undefined : marker.mention}
    >
      <div
        className={cn("tw-border-0 tw-border-l-[2px] tw-border-solid tw-pl-1.5", FOLD_BAR[kind])}
      >
        <AgentActivityCard
          icon={agent ? <AgentFace src={agent.faceSrc} size="xs" className="tw-size-3.5" /> : Bot}
          label={
            <span className={cn("tw-truncate", kind === "didnt_finish" && "tw-text-error")}>
              {foldLabel(kind, marker.name, reply)}
            </span>
          }
          expandable={Boolean(reply || reason)}
          open={open}
          onToggle={() => setOpen((was) => !was)}
        >
          {reason ? (
            <div className="tw-select-text tw-break-words tw-text-sm tw-text-muted">
              {reason.details ? `${reason.reason}: ${reason.details}` : reason.reason}
            </div>
          ) : null}
          {reply ? (
            <div className="tw-select-text tw-break-words">
              <AgentMarkdownText text={reply} app={app} />
            </div>
          ) : null}
        </AgentActivityCard>
      </div>
      {fileChanges && fileChanges.length > 0 ? (
        <FilesChangedCard changes={fileChanges} onOpen={onOpenFileChange} />
      ) : null}
    </div>
  );
};

import { agentTitle } from "@/agents/agentTitle";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { AgentFace } from "@/agents/ui/AgentFace";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import React from "react";

export interface AgentIdentityBarProps {
  agent: CustomAgent;
  onOpenProfile?: (slug: string) => void;
}

const BAR_CLASS =
  "tw-flex tw-w-full tw-shrink-0 tw-items-center tw-gap-2.5 tw-border-0 tw-border-b tw-border-solid tw-border-border tw-px-3.5 tw-py-2 tw-text-left";

export function AgentIdentityBar({ agent, onOpenProfile }: AgentIdentityBarProps) {
  const identity = (
    <>
      <AgentFace src={agent.faceSrc} size="m" />
      <span className="tw-flex tw-min-w-0 tw-flex-col">
        <span className="tw-truncate tw-text-sm tw-font-semibold tw-leading-tight tw-text-normal">
          {agent.name}
        </span>
        <span className="tw-truncate tw-text-ui-smaller tw-text-muted">{agentTitle(agent)}</span>
      </span>
    </>
  );
  // Until a chat can open the agent's profile, the bar is plain text with no arrow, never a dead button.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/938
  if (!onOpenProfile) return <div className={BAR_CLASS}>{identity}</div>;
  return (
    <button
      type="button"
      aria-label={`Open ${agent.name}'s profile`}
      onClick={() => onOpenProfile(agent.slug)}
      className={cn(
        BAR_CLASS,
        "clickable-icon tw-group tw-h-auto tw-rounded-none tw-bg-transparent tw-shadow-none hover:tw-bg-modifier-hover"
      )}
    >
      {identity}
      <ChevronRight className="tw-ml-auto tw-size-3.5 tw-shrink-0 tw-text-faint group-hover:tw-text-muted" />
    </button>
  );
}

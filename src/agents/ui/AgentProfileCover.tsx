import type { CustomAgent } from "@/agents/CustomAgentStore";
import { cn } from "@/lib/utils";
import React, { useCallback, useState } from "react";

export interface AgentProfileRoute {
  agent: CustomAgent | null;
  open: (slug: string) => void;
  close: () => void;
}

export function useAgentProfileRoute(
  agents: readonly CustomAgent[],
  chatInputId: string
): AgentProfileRoute {
  const [route, setRoute] = useState<{ chatInputId: string; slug: string } | null>(null);
  const agent =
    route?.chatInputId === chatInputId
      ? (agents.find((candidate) => candidate.slug === route.slug) ?? null)
      : null;
  // A profile goes back by itself once its chat is no longer shown or its agent is gone, as when the folder is deleted on disk.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/940
  if (route && !agent) setRoute(null);
  const open = useCallback((slug: string) => setRoute({ chatInputId, slug }), [chatInputId]);
  const close = useCallback(() => setRoute(null), []);
  return { agent, open, close };
}

export interface AgentProfileCoverProps {
  profile: React.ReactNode;
  header?: React.ReactNode;
  children: React.ReactNode;
}

// The chat stays laid out, invisible, under the profile, so Back finds its scroll position and draft as they were.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/940
export function AgentProfileCover({ profile, header, children }: AgentProfileCoverProps) {
  return (
    <div className="tw-relative tw-flex tw-min-h-0 tw-flex-1 tw-flex-col">
      <div className={cn("tw-flex tw-min-h-0 tw-flex-1 tw-flex-col", profile && "tw-invisible")}>
        {header}
        <div className="tw-min-h-0 tw-flex-1">{children}</div>
      </div>
      {profile && <div className="tw-absolute tw-inset-0">{profile}</div>}
    </div>
  );
}

import type { CustomAgent } from "@/agents/CustomAgentStore";
import { AgentFace } from "@/agents/ui/AgentFace";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import React, { useMemo } from "react";

type ChatIcon = React.ComponentType<{ className?: string }>;

export interface AgentRecentChats {
  items: ChatHistoryItem[];
  getIcon?: (item: ChatHistoryItem) => ChatIcon | undefined;
  searchPlaceholder?: string;
  emptyState?: React.ReactNode;
}

const NO_CHATS = Object.freeze([]) as unknown as ChatHistoryItem[];

function faceIcon(src: string): ChatIcon {
  return function AgentFaceIcon() {
    return <AgentFace src={src} size="xs" />;
  };
}

function NoChatsWithAgent({ agent }: { agent: CustomAgent }) {
  return (
    <div className="tw-flex tw-flex-col tw-items-center tw-gap-1 tw-py-4 tw-text-center">
      <AgentFace src={agent.faceSrc} size="m" className="tw-mb-1 tw-opacity-80" />
      <div className="tw-text-ui-small tw-text-muted">No chats with {agent.name} yet.</div>
      <div className="tw-text-ui-smaller tw-text-faint">Your first message starts one.</div>
    </div>
  );
}

export function useAgentChatIcon(agents: readonly CustomAgent[]): AgentRecentChats["getIcon"] {
  return useMemo(() => {
    // With no agents listed (custom agents unavailable, or none made yet), Recent chats looks as it does without custom agents.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/588
    if (agents.length === 0) return undefined;
    const icons = new Map(agents.map((agent) => [agent.slug, faceIcon(agent.faceSrc)]));
    return (item: ChatHistoryItem) => (item.agent ? icons.get(item.agent) : undefined);
  }, [agents]);
}

export function useAgentRecentChats(
  items: ChatHistoryItem[],
  agents: readonly CustomAgent[],
  selected: CustomAgent | null
): AgentRecentChats {
  const getIcon = useAgentChatIcon(agents);

  return useMemo(() => {
    // Picking an agent's face narrows Recent chats to that agent's chats; Copilot lists every chat.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/588
    if (!selected) return { items, getIcon };
    const shown = items.filter((item) => item.agent === selected.slug);
    return {
      items: shown.length === 0 ? NO_CHATS : shown,
      getIcon,
      searchPlaceholder: `Search chats with ${selected.name}...`,
      emptyState: <NoChatsWithAgent agent={selected} />,
    };
  }, [items, getIcon, selected]);
}

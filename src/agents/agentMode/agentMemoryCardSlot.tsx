import { AGENT_MEMORY } from "@/agents/agentMode/agentMemoryChat";
import { AgentMemoryNoticeLine } from "@/agents/ui/AgentMemoryNoticeLine";
import { defineChatCardSlot, NO_PLACED_CHAT_CARDS } from "@/agentMode/ui/chatCards";
import { USER_SENDER } from "@/constants";
import { openVaultPath } from "@/utils/openVaultPath";
import React from "react";

export const agentMemoryCardSlot = defineChatCardSlot({
  key: AGENT_MEMORY,
  place: ({ notice }, messages) => {
    const userMessageIds = messages
      .filter((message) => message.sender === USER_SENDER)
      .map((message) => message.id);
    if (!notice || userMessageIds.length !== notice.afterUserTurn) return NO_PLACED_CHAT_CARDS;
    return [
      { id: notice.kind, afterUserMessageId: userMessageIds[notice.afterUserTurn - 1] ?? null },
    ];
  },
  render: ({ notice }, _cardId, { plugin }) =>
    notice ? (
      <AgentMemoryNoticeLine
        kind={notice.kind}
        agentName={notice.agentName}
        onOpen={() => openVaultPath(plugin.app, notice.path, { pane: "tab" })}
      />
    ) : null,
});

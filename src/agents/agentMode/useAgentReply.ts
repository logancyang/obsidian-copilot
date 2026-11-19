import type { AgentChatMessage } from "@/agentMode/session/types";
import { readAgentReply, type AgentReply } from "@/agents/agentReply";
import { useCustomAgentsGate } from "@/agents/customAgentsGate";
import { USER_SENDER } from "@/constants";
import { useMemo } from "react";

export function useAgentReply(message: AgentChatMessage): AgentReply | null {
  const gate = useCustomAgentsGate();
  return useMemo(
    () =>
      gate === "full" && message.sender === USER_SENDER ? readAgentReply(message.message) : null,
    [gate, message]
  );
}

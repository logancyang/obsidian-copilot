import type { AgentChatMessage } from "@/agentMode/session/types";
import { memorySaveTrail, type MemorySaveTrail } from "@/agents/agentMode/memorySaveCards";
import { useCustomAgentsGate } from "@/agents/customAgentsGate";
import { getVaultBase } from "@/utils/vaultPath";
import type { App } from "obsidian";
import { useMemo } from "react";

export function useMemorySaveTrail(message: AgentChatMessage, app: App): MemorySaveTrail | null {
  const gate = useCustomAgentsGate();
  return useMemo(
    () => (gate === "full" ? memorySaveTrail(message, getVaultBase(app)) : null),
    [gate, message, app]
  );
}

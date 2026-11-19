import { openAgentFile } from "@/agents/agentMode/memorySaveCards";
import { useAgentProfileFacts } from "@/agents/agentMode/ui/useAgentProfileFacts";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { AgentProfileView } from "@/agents/ui/AgentProfileView";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { logError } from "@/logger";
import type { App } from "obsidian";
import React from "react";

export interface AgentProfileProps {
  agent: CustomAgent;
  app: App;
  manager: AgentSessionManager;
  onBack: () => void;
  onNewChat: (agent: CustomAgent) => void;
}

export function AgentProfile({ agent, app, manager, onBack, onNewChat }: AgentProfileProps) {
  const facts = useAgentProfileFacts(app, manager, agent);
  return (
    <AgentProfileView
      agent={agent}
      facts={facts}
      onBack={onBack}
      onNewChat={() => onNewChat(agent)}
      onOpenFile={(path) =>
        void openAgentFile(app, path).catch((error: unknown) =>
          logError(`[Custom agents] Could not open ${path}`, error)
        )
      }
    />
  );
}

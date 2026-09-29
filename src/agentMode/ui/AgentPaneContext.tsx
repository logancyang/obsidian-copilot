import type { SessionId } from "@/agentMode/session/types";
import * as React from "react";

export interface PlanPreviewRequest {
  proposalId: string;
  sessionId: SessionId;
  planMarkdown: string;
  title?: string;
}

// The message pane reads the client replica and sends commands; everything else it needs from
// its surroundings arrives here, so the same components run where a vault, an editor or a
// workspace leaf is unavailable. An omitted action hides the control that would call it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/611
export interface AgentPaneCapabilities {
  vaultBase: string | null;
  openPath?: (path: string, options?: { newLeaf?: boolean }) => void;
  insertAtCursor?: (text: string) => void;
  openPlanPreview?: (request: PlanPreviewRequest) => Promise<void>;
  closePlanPreview?: (proposalId: string) => void;
}

export const NO_PANE_CAPABILITIES: AgentPaneCapabilities = Object.freeze({ vaultBase: null });

const AgentPaneCapabilitiesContext =
  React.createContext<AgentPaneCapabilities>(NO_PANE_CAPABILITIES);

export const AgentPaneCapabilitiesProvider = AgentPaneCapabilitiesContext.Provider;

export function useAgentPaneCapabilities(): AgentPaneCapabilities {
  return React.useContext(AgentPaneCapabilitiesContext);
}

import type { BackendId, CopilotMode, SessionId } from "@/agentMode/session/types";
import * as React from "react";

export interface PlanPreviewRequest {
  proposalId: string;
  sessionId: SessionId;
  planMarkdown: string;
  title?: string;
}

// A pick in the composer can also change what the desktop starts with next time. That is a
// settings change, so it is a desktop capability the client calls after the host accepts the
// command; the protocol itself never changes settings.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/612
export interface PersistDefaults {
  setDefaultBackend: (backendId: BackendId) => void;
  persistDefaultMode: (backendId: BackendId, mode: CopilotMode) => void;
}

// The message pane, composer, pickers and tab strip read the client replica and send commands;
// everything else they need from their surroundings arrives here, so the same components run where
// a vault, an editor, a workspace leaf or the backend registry is unavailable. An omitted action
// hides the control that would call it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/611
export interface AgentPaneCapabilities {
  vaultBase: string | null;
  backendIcon?: (backendId: BackendId) => React.ComponentType<{ className?: string }> | undefined;
  persistDefaults?: PersistDefaults;
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

import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { AgentSelectView } from "@/agentMode/ui/AgentSelectView";
import { useAgentSelect } from "@/agentMode/ui/useAgentSelect";
import type CopilotPlugin from "@/main";
import React from "react";

interface Props {
  plugin: CopilotPlugin;
  manager: AgentSessionManager;
}

/**
 * Binds the pure `AgentSelectView` to the plugin's live backend state. It owns
 * no derivation of its own — `useAgentSelect` decides which agents exist, which
 * one is selected, and what the single call to action does — so the view stays
 * mountable from the component gallery with fixture props alone.
 * @param plugin - Plugin instance backing readiness subscriptions and Configure dialogs.
 * @param manager - Session manager that commits the choice and spawns the chat.
 */
export const AgentSelectPanel: React.FC<Props> = ({ plugin, manager }) => {
  const { rows, selectedId, select, cta, runCta } = useAgentSelect(plugin, manager);
  return (
    <AgentSelectView
      rows={rows}
      selectedId={selectedId}
      onSelect={select}
      ctaLabel={cta.label}
      footerNote={cta.note}
      onCta={runCta}
      ctaDisabled={cta.action === "wait"}
    />
  );
};

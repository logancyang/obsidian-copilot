import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { AgentSelectView } from "@/agentMode/ui/AgentSelectView";
import { useAgentSelect } from "@/agentMode/ui/useAgentSelect";
import type CopilotPlugin from "@/main";
import React from "react";

interface Props {
  plugin: CopilotPlugin;
  manager: AgentSessionManager;
}

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

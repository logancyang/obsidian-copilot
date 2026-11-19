import { agentSetupProblem, type AgentSetupProblem } from "@/agents/agentMode/agentChats";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { useBackendInstallStates } from "@/agentMode/ui/useBackendDescriptor";
import type CopilotPlugin from "@/main";
import { useSettingsValue } from "@/settings/model";
import { useMemo } from "react";

export type AgentSetupProblems = ReadonlyMap<string, AgentSetupProblem>;

const NO_SETUP_PROBLEMS: AgentSetupProblems = new Map();

export function useAgentSetupProblems(
  plugin: CopilotPlugin,
  agents: readonly Pick<CustomAgent, "slug" | "model">[]
): AgentSetupProblems {
  const settings = useSettingsValue();
  const installStates = useBackendInstallStates(plugin);
  return useMemo(() => {
    void installStates;
    const problems = new Map<string, AgentSetupProblem>();
    for (const agent of agents) {
      const problem = agentSetupProblem(settings, agent.model);
      if (problem) problems.set(agent.slug, problem);
    }
    return problems.size > 0 ? problems : NO_SETUP_PROBLEMS;
  }, [settings, installStates, agents]);
}

import { useHostSelector } from "@/agentMode/protocol/react";
import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import type { BackendSummary } from "@/agentMode/protocol/state";
import { useAgentPaneCapabilities } from "@/agentMode/ui/AgentPaneContext";
import {
  EMPTY_AGENT_MENTION_BRANDS,
  type AgentMentionBrand,
} from "@/components/chat-components/hooks/useAtMentionCategories";
import { Bot } from "lucide-react";
import { useMemo } from "react";

const EMPTY_CLOUD_IDS: ReadonlySet<string> = Object.freeze(new Set<string>());

const selectBackends = (host: { backends: readonly BackendSummary[] }) => host.backends;

export interface AgentBrands {
  installed: ReadonlyArray<AgentMentionBrand>;
  cloudAgentIds: ReadonlySet<string>;
}

/**
 * The agents the `@` menu offers, drawn from the host's picker catalog. Readiness comes from the
 * host, so a client needs no install checks of its own; icons come from the environment.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/612
 */
export function useAgentBrands(client: SessionClient): AgentBrands {
  const backends = useHostSelector(client, selectBackends);
  const backendIcon = useAgentPaneCapabilities().backendIcon;
  return useMemo(() => {
    const ready = (backends ?? []).filter((backend) => backend.readiness === "ready");
    const cloud = (backends ?? []).filter((backend) => !backend.selfHostable);
    return {
      installed:
        ready.length === 0
          ? EMPTY_AGENT_MENTION_BRANDS
          : ready.map((backend) => ({
              id: backend.id,
              displayName: backend.displayName,
              Icon: backendIcon?.(backend.id) ?? Bot,
              needsSelfHostWarning: backend.selfHostWarning,
            })),
      cloudAgentIds:
        cloud.length === 0 ? EMPTY_CLOUD_IDS : new Set(cloud.map((backend) => backend.id)),
    };
  }, [backends, backendIcon]);
}

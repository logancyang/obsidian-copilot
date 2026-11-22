import type { AgentSession, AgentSessionStatus } from "@/agentMode/session/AgentSession";
import type { AgentChatMessage, BackendState } from "@/agentMode/session/types";
import type { AskedAgentChat } from "@/agents/agentMode/hiddenAgentChats";

const SONNET: BackendState = {
  model: {
    current: { baseModelId: "sonnet", effort: null },
    availableModels: [
      { baseModelId: "sonnet", name: "Sonnet 5.5", provider: null, effortOptions: [] },
    ],
    apply: { kind: "setModel" },
  },
  mode: null,
};

export function askedAgentChatFixture(
  messages: readonly AgentChatMessage[],
  status: AgentSessionStatus,
  continuedAt: ReadonlyMap<string, number> = new Map()
): AskedAgentChat {
  const session = {
    store: { getDisplayMessages: () => messages },
    subscribe: () => () => {},
    getStatus: () => status,
    getState: () => SONNET,
  } as unknown as AgentSession;
  return { session, continuedAt };
}

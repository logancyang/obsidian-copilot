import type { ToolListing } from "@/agentMode/session/copilotMcpServer";
import type { CustomAgent } from "@/agents/CustomAgentStore";

const COCO = { slug: "coco", name: "Coco", title: "Houseplant carer" } as CustomAgent;
const MAYA = { slug: "maya", name: "Maya", title: "Product critic" } as CustomAgent;
const LEO = { slug: "leo", name: "Leo", title: "" } as CustomAgent;
const ASKED_COCO_CHAT = "asked-coco-chat";

export const CHAT_LISTINGS = {
  "a Copilot chat": { sessionKey: "copilot-chat", backendId: "claude" },
  "Coco's own chat": { sessionKey: "coco-chat", backendId: "codex", agentSlug: "coco" },
  "the chat Coco runs when asked": {
    sessionKey: ASKED_COCO_CHAT,
    backendId: "claude",
    agentSlug: "coco",
  },
  "OpenCode's shared folder listing": {
    sessionKey: "opencode:/vault",
    backendId: "opencode",
    shared: true,
  },
} satisfies Record<string, ToolListing>;

export const AGENT_SETS = {
  "no agent": [],
  "only Coco": [COCO],
  "Coco and Maya": [COCO, MAYA],
  "Coco, Maya and Leo": [COCO, MAYA, LEO],
} satisfies Record<string, readonly CustomAgent[]>;

export type ChatKind = keyof typeof CHAT_LISTINGS;
export type AgentSet = keyof typeof AGENT_SETS;

export function toolHost(agents: AgentSet | readonly CustomAgent[] = []) {
  const listed = typeof agents === "string" ? agentsIn(agents) : agents;
  return {
    isUnlistedChat: (sessionKey: string) => sessionKey === ASKED_COCO_CHAT,
    agents: () => listed,
  };
}

export interface ListingCase {
  chat: ChatKind;
  agents: AgentSet;
  listed: boolean;
  label: string;
}

function chatCanExist(chat: ChatKind, agents: AgentSet): boolean {
  const runsCoco = "agentSlug" in CHAT_LISTINGS[chat];
  return !runsCoco || agentsIn(agents).some((agent) => agent.slug === "coco");
}

export function agentsIn(set: AgentSet): readonly CustomAgent[] {
  return AGENT_SETS[set];
}

export function listingCases(listedFor: Readonly<Record<ChatKind, readonly AgentSet[]>>) {
  return (Object.keys(CHAT_LISTINGS) as ChatKind[]).flatMap((chat) =>
    (Object.keys(AGENT_SETS) as AgentSet[])
      .filter((agents) => chatCanExist(chat, agents))
      .map((agents): ListingCase => {
        const listed = listedFor[chat].includes(agents);
        return {
          chat,
          agents,
          listed,
          label: `${listed ? "lists" : "leaves out"} the tool for ${chat} when the agents are ${agents}`,
        };
      })
  );
}

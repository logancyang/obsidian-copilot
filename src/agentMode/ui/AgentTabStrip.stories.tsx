import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { SessionAgent } from "@/agentMode/session/sessionAgent";
import { AgentTabStrip } from "@/agentMode/ui/AgentTabStrip";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type AgentTabStripProps = React.ComponentProps<typeof AgentTabStrip>;

/** The built-in answerer as a session holds it (fixture, not the constant). */
const COPILOT: SessionAgent = {
  slug: null,
  name: "Copilot",
  icon: "✦",
  personaBlock: null,
  memory: null,
};

/** One inert tab fixture: enough surface for the strip to render a session. */
function tab(fields: { id: string; label: string | null; agent?: SessionAgent }): AgentSession {
  return {
    internalId: fields.id,
    chatInputId: fields.id,
    backendId: "opencode",
    subscribe: () => () => {},
    getLabel: () => fields.label,
    getAgent: () => fields.agent ?? COPILOT,
    getStatus: () => "idle",
    getNeedsAttention: () => false,
  } as unknown as AgentSession;
}

const JENNIFER: SessionAgent = {
  slug: "jennifer",
  name: "Jennifer",
  icon: "🪶",
  personaBlock: '<agent_persona name="Jennifer">…</agent_persona>',
  memory: null,
};

function managerWith(sessions: AgentSession[]): AgentSessionManager {
  return {
    subscribe: () => () => {},
    subscribeModelCache: () => () => {},
    getSessionsForScope: () => sessions,
    getActiveProjectId: () => "__global__",
    getActiveSession: () => sessions[0],
    getIsStarting: () => false,
    setActiveSession: () => {},
    createSession: async () => sessions[0],
    closeSession: async () => {},
    renameSession: () => {},
  } as unknown as AgentSessionManager;
}

const meta = {
  title: "Agent Mode/Tab Strip",
  component: AgentTabStrip,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentTabStripProps>;
export default meta;

/** The strip needs a tooltip provider, which its production tree supplies. */
function Strip({ sessions }: { sessions: AgentSession[] }): React.ReactElement {
  return (
    <TooltipProvider>
      <AgentTabStrip manager={managerWith(sessions)} />
    </TooltipProvider>
  );
}

/** A Copilot chat is unchanged: the backend's brand glyph and the chat title. */
export const CopilotChat: StoryObj<AgentTabStripProps> = {
  render: () => <Strip sessions={[tab({ id: "a", label: "Grid storage explainer" })]} />,
};

/**
 * A fresh DM says who will answer before the chat has a title of its own
 * (`designdocs/CUSTOM_AGENTS.md` §3).
 */
export const UntitledAgentChat: StoryObj<AgentTabStripProps> = {
  render: () => <Strip sessions={[tab({ id: "a", label: null, agent: JENNIFER })]} />,
};

/** Once the chat has a title, the agent's icon is what keeps the answerer visible. */
export const TitledAgentChat: StoryObj<AgentTabStripProps> = {
  render: () => (
    <Strip
      sessions={[
        tab({ id: "a", label: "Newsletter intro", agent: JENNIFER }),
        tab({ id: "b", label: "Vault cleanup" }),
      ]}
    />
  ),
};

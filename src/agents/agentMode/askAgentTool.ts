import type {
  HostedTool,
  McpToolDefinition,
  ToolListing,
} from "@/agentMode/session/copilotMcpServer";
import type { AskAgentResult, HiddenAgentChats } from "@/agents/agentMode/hiddenAgentChats";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { RELAY_PRINCIPLE } from "@/agents/agentReply";
import { getCustomAgentsGate } from "@/agents/customAgentsGate";

export const ASK_AGENT_TOOL_NAME = "ask_agent";
const UNAVAILABLE_TEXT = "Custom agents aren't available right now. Tell the user.";

export interface AskAgentToolHost {
  agents: () => readonly CustomAgent[];
  isUnlistedChat: (sessionKey: string) => boolean;
  agentOfChat: (sessionKey: string) => string | null;
}

const ASK_AGENT_TOOL = Object.freeze({
  name: ASK_AGENT_TOOL_NAME,
  inputSchema: {
    type: "object",
    properties: {
      agent: { type: "string", description: "The agent's name, as listed in this description." },
      message: {
        type: "string",
        description:
          "Everything the agent needs, since it can't see this chat: the user's request in their own words, and the notes and context that matter.",
      },
    },
    required: ["agent", "message"],
  },
  // Asking changes nothing by itself; the asked agent's own edits follow this chat's mode.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/944
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  // Claude Code defers MCP tools behind tool search, hiding the description that says when to call it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/944
  _meta: { "anthropic/alwaysLoad": true },
});

// OpenCode's Code Mode catalog shows only the first ~120 characters of a description, so the opening carries when to call it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/944
function describe(roster: readonly CustomAgent[]): string {
  return `Ask another custom agent only when the user's message @-mentions it by name or clearly points to it. Never call it otherwise, and never for yourself.

Agents you can ask:
${roster.map((agent) => `- ${agent.name}${agent.title ? ` (${agent.title})` : ""}`).join("\n")}

The agent works in the background, in its own chat with its own instruction and memory, and can't see this chat. The call returns at once. Then tell the user in one short line who you asked and that you'll bring back the reply, and end your turn. Don't wait for the reply or check on it. When the reply comes back, pass it on. ${RELAY_PRINCIPLE}

An agent you ask can't save rules to its memory or change its instruction from a chat it was asked into. If the user wants it to remember something, say so when you pass on its reply, and tell them to say it in that agent's own chat, where it will remember.`;
}

function askAgentDefinition(roster: readonly CustomAgent[]): McpToolDefinition {
  const definition = { ...ASK_AGENT_TOOL, description: describe(roster) };
  return definition;
}

function resultText(result: AskAgentResult): string {
  switch (result.kind) {
    case "asked":
      return `${result.agent.name} is working on it in the background. Tell the user in one short line that you asked ${result.agent.name} and will bring back the reply, then end your turn.`;
    case "unavailable":
      return UNAVAILABLE_TEXT;
    case "not_from_here":
      return `You can't ask another agent from this chat. Don't call ${ASK_AGENT_TOOL_NAME} again.`;
    case "unknown_agent":
      return result.roster.length > 0
        ? `No custom agent has that name. Agents you can ask: ${result.roster.map((agent) => agent.name).join(", ")}.`
        : "There are no other custom agents to ask.";
    case "self":
      return `You are ${result.agent.name}; you can't ask yourself. Answer the user directly.`;
    case "busy":
      return `${result.agent.name} is still working on the earlier request from this chat. Tell the user you'll bring back the reply when ${result.agent.name} is done, and that they can ask again after that.`;
  }
}

export function createAskAgentTool(chats: HiddenAgentChats, host: AskAgentToolHost): HostedTool {
  return {
    definition: askAgentDefinition([]),
    turnedOffText: UNAVAILABLE_TEXT,
    // Only a chat the user sees can ask, never itself, and only while custom agents are available.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/944
    listedAs: ({ sessionKey }: ToolListing): McpToolDefinition | null => {
      if (getCustomAgentsGate() !== "full" || host.isUnlistedChat(sessionKey)) return null;
      const self = host.agentOfChat(sessionKey);
      const roster = host.agents().filter((agent) => agent.slug !== self);
      return roster.length > 0 ? askAgentDefinition(roster) : null;
    },
    call: async (args, chat) => {
      const { agent, message } = (args ?? {}) as Record<string, unknown>;
      if (typeof agent !== "string" || typeof message !== "string" || !message.trim()) {
        return { text: "agent and message must be non-empty strings.", isError: true };
      }
      const result = chats.ask(chat, agent, message);
      return {
        text: resultText(result),
        isError: result.kind === "unknown_agent",
      };
    },
  };
}

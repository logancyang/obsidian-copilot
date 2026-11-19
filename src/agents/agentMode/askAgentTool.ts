import type { ChatStateHost } from "@/agentMode/session/chatExtension";
import type {
  HostedTool,
  McpToolDefinition,
  ToolListing,
} from "@/agentMode/session/copilotMcpServer";
import type {
  AgentRefusal,
  AskAgentResult,
  CheckAgentResult,
  HiddenAgentChats,
  StopAgentResult,
} from "@/agents/agentMode/hiddenAgentChats";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { RELAY_PRINCIPLE } from "@/agents/agentReply";
import { getCustomAgentsGate } from "@/agents/customAgentsGate";

export const ASK_AGENT_TOOL_NAME = "ask_agent";
export const STOP_AGENT_TOOL_NAME = "stop_agent";
export const CHECK_AGENT_TOOL_NAME = "check_agent";
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

function refusalText(result: AgentRefusal, toolName: string): string {
  switch (result.kind) {
    case "unavailable":
      return UNAVAILABLE_TEXT;
    case "not_from_here":
      return `You can't ask another agent from this chat. Don't call ${toolName} again.`;
    case "unknown_agent":
      return result.roster.length > 0
        ? `No custom agent has that name. Agents you can ask: ${result.roster.map((agent) => agent.name).join(", ")}.`
        : "There are no other custom agents to ask.";
    case "self":
      return `You are ${result.agent.name}; you can't ask yourself. Answer the user directly.`;
  }
}

function resultText(result: AskAgentResult): string {
  switch (result.kind) {
    case "asked":
      return `${result.agent.name} is working on it in the background. Tell the user in one short line that you asked ${result.agent.name} and will bring back the reply, then end your turn.`;
    case "sent":
      return `Sent ${result.agent.name} your message in the chat ${result.agent.name} is working in; ${result.agent.name} ${result.now ? "reads it now" : "gets it after the current step"}. Tell the user in one short line, then end your turn.`;
    default:
      return refusalText(result, ASK_AGENT_TOOL_NAME);
  }
}

function checkResultText(result: CheckAgentResult): string {
  switch (result.kind) {
    case "progress":
      return `${result.progress}\n\nTell the user in your own words how far ${result.agent.name} got. Don't paste this.`;
    case "not_asked":
      return `${result.agent.name} isn't working on anything from this chat now. To send ${result.agent.name} back to it, use ${ASK_AGENT_TOOL_NAME}.`;
    default:
      return refusalText(result, CHECK_AGENT_TOOL_NAME);
  }
}

function stopResultText(result: StopAgentResult): string {
  switch (result.kind) {
    case "stopped":
      return `Stopped ${result.agent.name}. ${result.agent.name}'s changes stay. End your turn now; ${result.agent.name}'s report comes next, and then you tell the user how far ${result.agent.name} got and what changed.`;
    case "not_working":
      return `${result.agent.name} isn't working on anything from this chat, so there is nothing to stop.`;
    case "not_asked":
      return `${result.agent.name} isn't working on anything from this chat now.`;
    default:
      return refusalText(result, STOP_AGENT_TOOL_NAME);
  }
}

// Only a chat the user sees can ask, never itself, and only while custom agents are available.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/944
function listedForAskingChats(
  host: AskAgentToolHost,
  definition: (roster: readonly CustomAgent[]) => McpToolDefinition
): HostedTool["listedAs"] {
  return ({ sessionKey }: ToolListing): McpToolDefinition | null => {
    if (getCustomAgentsGate() !== "full" || host.isUnlistedChat(sessionKey)) return null;
    const self = host.agentOfChat(sessionKey);
    const roster = host.agents().filter((agent) => agent.slug !== self);
    return roster.length > 0 ? definition(roster) : null;
  };
}

export function createAskAgentTool(chats: HiddenAgentChats, host: AskAgentToolHost): HostedTool {
  return {
    definition: askAgentDefinition([]),
    turnedOffText: UNAVAILABLE_TEXT,
    listedAs: listedForAskingChats(host, askAgentDefinition),
    call: async (args, chat) => {
      const { agent, message } = (args ?? {}) as Record<string, unknown>;
      if (typeof agent !== "string" || typeof message !== "string" || !message.trim()) {
        return { text: "agent and message must be non-empty strings.", isError: true };
      }
      const result = chats.ask(chat, agent, message);
      // The chat draws a call's line from its error flag, so a call that asked no one fails.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/945
      return {
        text: resultText(result),
        isError: result.kind !== "asked" && result.kind !== "sent",
      };
    },
  };
}

// Only the chat that asked an agent can check on or stop it, so each call names the agent and the calling chat decides.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/945
function askedAgentTool(
  name: string,
  description: string,
  host: AskAgentToolHost,
  call: (chat: ChatStateHost | null, agent: string) => { text: string; isError: boolean }
): HostedTool {
  const definition: McpToolDefinition = Object.freeze({
    name,
    description,
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "The name of an agent you asked from this chat." },
      },
      required: ["agent"],
    },
    // Checking on or stopping an agent changes no file, and Codex asks the user before any tool that isn't read-only.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/945
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { "anthropic/alwaysLoad": true },
  });
  return {
    definition,
    turnedOffText: UNAVAILABLE_TEXT,
    listedAs: listedForAskingChats(host, () => definition),
    call: async (args, chat) => {
      const { agent } = (args ?? {}) as Record<string, unknown>;
      if (typeof agent !== "string" || !agent.trim()) {
        return { text: "agent must be a non-empty string.", isError: true };
      }
      return call(chat, agent);
    },
  };
}

export function createCheckAgentTool(chats: HiddenAgentChats, host: AskAgentToolHost): HostedTool {
  return askedAgentTool(
    CHECK_AGENT_TOOL_NAME,
    "Read how an agent you asked from this chat is doing: call it each time the user asks how an agent you asked is doing, even if you think you know. It doesn't interrupt the agent. It returns how long the agent has worked, the end of what it has written and its latest steps; tell the user in your own words how far it got. To give it a new instruction while it works, call ask_agent again.",
    host,
    (chat, agent) => {
      const result = chats.check(chat, agent);
      return { text: checkResultText(result), isError: result.kind !== "progress" };
    }
  );
}

export function createStopAgentTool(chats: HiddenAgentChats, host: AskAgentToolHost): HostedTool {
  return askedAgentTool(
    STOP_AGENT_TOOL_NAME,
    "Stop an agent you asked from this chat, when the user tells you to stop it. It stops at once and its changes stay. Then end your turn: its report comes back next, with how far it got and what it changed, and you pass that on.",
    host,
    (chat, agent) => {
      const result = chats.stop(chat, agent);
      return { text: stopResultText(result), isError: result.kind !== "stopped" };
    }
  );
}

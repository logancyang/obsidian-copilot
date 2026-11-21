import type { ChatStateHost } from "@/agentMode/session/chatExtension";
import type {
  HostedTool,
  HostedToolResult,
  McpToolDefinition,
  ToolListing,
} from "@/agentMode/session/copilotMcpServer";
import type {
  AgentRefusal,
  AnswerAgentResult,
  AskAgentResult,
  CheckAgentResult,
  HiddenAgentChats,
  StopAgentResult,
} from "@/agents/agentMode/hiddenAgentChats";
import { ASK_AGENT_TOOL_NAME } from "@/agents/agentMentionPrompt";
import {
  ANSWER_AGENT_TOOL_NAME,
  CHECK_AGENT_TOOL_NAME,
  STOP_AGENT_TOOL_NAME,
} from "@/agents/agentMode/agentToolCalls";
import { RELAY_PRINCIPLE } from "@/agents/agentReply";
import {
  AI_TEAMMATE_DEFINITION,
  ASK_AGENT_PROMPT_HINT,
  describeAgent,
  mayReachCopilotChat,
} from "@/agents/agentSessionPrompt";
import type { CustomAgent, CustomAgentStore } from "@/agents/CustomAgentStore";
import { getCustomAgentsGate, subscribeToCustomAgentsGate } from "@/agents/customAgentsGate";

export const ASK_USER_TOOL_NAME = "ask_user";
const UNAVAILABLE_TEXT = "Copilot Teammates isn't available right now. Tell the user.";

export interface AskAgentToolHost {
  isUnlistedChat: (sessionKey: string) => boolean;
  agents: () => readonly Pick<CustomAgent, "slug">[];
}

// OpenCode's Code Mode catalog shows only the first ~120 characters of a description, so the opening carries when to call it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/944
const ASK_AGENT_TOOL = Object.freeze({
  name: ASK_AGENT_TOOL_NAME,
  description: `Ask another AI teammate only when the user's message @-mentions it by name or clearly points to it. Never call it otherwise, and never for yourself.

When the user names an AI teammate without an @, or only describes its job, call this with the name or job they gave: a name no AI teammate has answers with the AI teammates you can ask.

The AI teammate works in the background, in its own chat with its own instruction and memory, and can't see this chat. The call returns at once. Then tell the user in one short line who you asked and that you'll bring back the reply, and end your turn. Don't wait for the reply or check on it. When the reply comes back, pass it on. ${RELAY_PRINCIPLE}

Pass a rule the user gives it for later in the user's own words.`,
  inputSchema: {
    type: "object",
    properties: {
      teammate: { type: "string", description: "The AI teammate's name." },
      message: {
        type: "string",
        description:
          "Everything the AI teammate needs, since it can't see this chat: the user's request in their own words, and the notes and context that matter.",
      },
    },
    required: ["teammate", "message"],
  },
  // Asking changes nothing by itself; the asked agent's own edits follow this chat's mode.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/944
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  // Claude Code defers MCP tools behind tool search, hiding the description that says when to call it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/944
  _meta: { "anthropic/alwaysLoad": true },
}) satisfies McpToolDefinition;

function refusalText(result: AgentRefusal, toolName: string): string {
  switch (result.kind) {
    case "unavailable":
      return UNAVAILABLE_TEXT;
    case "not_from_here":
      return `You can't ask another AI teammate from this chat. Don't call ${toolName} again.`;
    case "unknown_agent":
      return result.roster.length > 0
        ? `No AI teammate has that name. AI teammates you can ask: ${result.roster.map(describeAgent).join("; ")}.`
        : "There are no other AI teammates to ask.";
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
    case "cannot_run":
      return `Nothing was sent: ${result.reason} Tell the user, and that they can pick another model in ${result.agent.name}'s profile.`;
    case "awaiting_answer":
      return `Nothing was sent: ${result.agent.name} is waiting for the user's answer to this question:\n${result.question}\n\nAsk the user this question in your own words if you haven't yet, then end your turn. When the user replies to it, even with a change of plan, pass their words to ${result.agent.name} with ${ANSWER_AGENT_TOOL_NAME}.`;
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

function answerResultText(result: AnswerAgentResult): string {
  switch (result.kind) {
    case "answered":
      return `Passed the answer to ${result.agent.name}, who carries on. Tell the user in one short line, then end your turn.`;
    case "no_question":
      return `${result.agent.name} has no question waiting. To send ${result.agent.name} a new instruction, use ${ASK_AGENT_TOOL_NAME}.`;
    default:
      return refusalText(result, ANSWER_AGENT_TOOL_NAME);
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

// Only a chat the user sees can ask, and only while custom agents are available. The listing names no agent, since OpenCode keeps one listing for its whole process; the call finds the agent by name.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/944
// A chat with no other agent to ask isn't offered the tools; OpenCode's shared listing can't tell whose chat lists, so any agent counts there.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/987
function listedForAskingChats(
  host: AskAgentToolHost,
  definition: McpToolDefinition
): HostedTool["listedAs"] {
  return ({ sessionKey, agentSlug }: ToolListing): McpToolDefinition | null =>
    getCustomAgentsGate() === "full" &&
    !host.isUnlistedChat(sessionKey) &&
    host.agents().some((agent) => agent.slug !== agentSlug)
      ? definition
      : null;
}

// OpenCode lists a folder's tools once for every chat in it, so custom agents unlocking or locking while it runs has it list them again.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/944
// Which tools a chat is offered also follows which agents exist, so an agent created or deleted has open chats list them again.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/987
export function relistOnAgentsChange(
  store: Pick<CustomAgentStore, "getAgents" | "subscribe">,
  relist: () => void
): () => void {
  const listingKey = () =>
    `${getCustomAgentsGate() === "full"} ${store
      .getAgents()
      .map((agent) => agent.slug)
      .join("/")}`;
  let key = listingKey();
  const onChange = (): void => {
    const next = listingKey();
    if (next === key) return;
    key = next;
    relist();
  };
  const unsubscribes = [subscribeToCustomAgentsGate(onChange), store.subscribe(onChange)];
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}

// check_teammate, answer_teammate and stop_teammate are always offered together, so each carries the one sentence that names all three.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/986
const ASKED_AGENT_PROMPT_HINT =
  "When the user asks how an AI teammate you asked is doing, check with check_teammate; when the user answers its question, pass the answer with answer_teammate; when the user gives it a new instruction while it works, send that with ask_teammate; when the user tells you to stop it, use stop_teammate. All are in obsidian-copilot.";

// The chat draws a call's line from its error flag, so a call that did nothing for the agent it names fails.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/945
// A valid call answered with how things stand, as for a name no agent has or an agent not working now, isn't an error, so the chat draws no failed step and no Copilot tool reads as erroring; an answer whose line would claim what didn't happen, as "Stopped" for nothing to stop, keeps the flag.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/987
function failed(kind: string, ...answered: string[]): boolean {
  return ![...answered, "unknown_agent"].includes(kind);
}

const DEFINING_ASK_AGENT_TOOL: McpToolDefinition = Object.freeze({
  ...ASK_AGENT_TOOL,
  description: `${AI_TEAMMATE_DEFINITION} ${ASK_AGENT_TOOL.description}`,
});

export function createAskAgentTool(chats: HiddenAgentChats, host: AskAgentToolHost): HostedTool {
  const listed = listedForAskingChats(host, ASK_AGENT_TOOL);
  return {
    definition: ASK_AGENT_TOOL,
    turnedOffText: UNAVAILABLE_TEXT,
    listedAs: (listing) =>
      listed?.(listing)
        ? mayReachCopilotChat(listing)
          ? DEFINING_ASK_AGENT_TOOL
          : ASK_AGENT_TOOL
        : null,
    promptHint: (listing) =>
      mayReachCopilotChat(listing)
        ? `${AI_TEAMMATE_DEFINITION} ${ASK_AGENT_PROMPT_HINT}`
        : ASK_AGENT_PROMPT_HINT,
    call: async (args, chat) => {
      const { teammate: agent, message } = (args ?? {}) as Record<string, unknown>;
      if (typeof agent !== "string" || typeof message !== "string" || !message.trim()) {
        return { text: "teammate and message must be non-empty strings.", isError: true };
      }
      const result = chats.ask(chat, agent, message);
      return { text: resultText(result), isError: failed(result.kind, "asked", "sent") };
    },
  };
}

interface ToolText {
  name: string;
  description: string;
}

// Only the chat that asked an agent can check on, answer for or stop it, so each call names the agent and the calling chat decides.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/945
function askedAgentTool(
  { name, description }: ToolText,
  host: AskAgentToolHost,
  call: (chat: ChatStateHost | null, agent: string, text: string) => HostedToolResult,
  textArgument?: ToolText
): HostedTool {
  const definition: McpToolDefinition = Object.freeze({
    name,
    description,
    inputSchema: {
      type: "object",
      properties: {
        teammate: {
          type: "string",
          description: "The name of an AI teammate you asked from this chat.",
        },
        ...(textArgument
          ? { [textArgument.name]: { type: "string", description: textArgument.description } }
          : {}),
      },
      required: ["teammate", ...(textArgument ? [textArgument.name] : [])],
    },
    // Checking on or stopping an agent changes no file, and Codex asks the user before any tool that isn't read-only.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/945
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { "anthropic/alwaysLoad": true },
  });
  return {
    definition,
    turnedOffText: UNAVAILABLE_TEXT,
    listedAs: listedForAskingChats(host, definition),
    promptHint: ASKED_AGENT_PROMPT_HINT,
    call: async (args, chat) => {
      const fields = (args ?? {}) as Record<string, unknown>;
      const text = textArgument ? fields[textArgument.name] : "";
      const { teammate: agent } = fields;
      if (typeof agent !== "string" || !agent.trim() || typeof text !== "string") {
        return { text: "teammate must be a non-empty string.", isError: true };
      }
      if (textArgument && !text.trim()) {
        return { text: `${textArgument.name} must be a non-empty string.`, isError: true };
      }
      return call(chat, agent, text);
    },
  };
}

export function createCheckAgentTool(chats: HiddenAgentChats, host: AskAgentToolHost): HostedTool {
  return askedAgentTool(
    {
      name: CHECK_AGENT_TOOL_NAME,
      description:
        "Read how an AI teammate you asked from this chat is doing: call it each time the user asks how an AI teammate you asked is doing, even if you think you know. It doesn't interrupt the AI teammate. It returns how long the AI teammate has worked, the end of what it has written and its latest steps; tell the user in your own words how far it got. To give it a new instruction while it works, call ask_teammate again.",
    },
    host,
    (chat, agent) => {
      const result = chats.check(chat, agent);
      return {
        text: checkResultText(result),
        isError: failed(result.kind, "progress", "not_asked"),
      };
    }
  );
}

export function createStopAgentTool(chats: HiddenAgentChats, host: AskAgentToolHost): HostedTool {
  return askedAgentTool(
    {
      name: STOP_AGENT_TOOL_NAME,
      description:
        "Stop an AI teammate you asked from this chat, when the user tells you to stop it. It stops at once and its changes stay. Then end your turn: its report comes back next, with how far it got and what it changed, and you pass that on.",
    },
    host,
    (chat, agent) => {
      const result = chats.stop(chat, agent);
      return { text: stopResultText(result), isError: failed(result.kind, "stopped") };
    }
  );
}

export function createAnswerAgentTool(chats: HiddenAgentChats, host: AskAgentToolHost): HostedTool {
  return askedAgentTool(
    {
      name: ANSWER_AGENT_TOOL_NAME,
      description:
        "Pass the user's answer to an AI teammate you asked, when that AI teammate is waiting on a question you put to the user. The user answers you, never the AI teammate, so call this when their message answers it. If the user talks about something else, answer that and leave the question waiting.",
    },
    host,
    (chat, agent, answer) => {
      const result = chats.answer(chat, agent, answer);
      return { text: answerResultText(result), isError: failed(result.kind, "answered") };
    },
    { name: "answer", description: "The user's answer, in their own words." }
  );
}

const ASK_USER_TOOL: McpToolDefinition = Object.freeze({
  name: ASK_USER_TOOL_NAME,
  description:
    "Ask the user a question you can't go on without, from a chat another AI teammate or Copilot asked you into. The question reaches the user through that AI teammate or Copilot. After calling it, end your turn: the user's answer comes back as your next message.",
  inputSchema: {
    type: "object",
    properties: { question: { type: "string", description: "One question, in plain words." } },
    required: ["question"],
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  _meta: { "anthropic/alwaysLoad": true },
});

const ASK_USER_RESULT_TEXT = Object.freeze({
  asked:
    "Your question is on its way to the user. End your turn now without saying more; the answer comes back as your next message.",
  unavailable: UNAVAILABLE_TEXT,
  not_from_here: `Only an AI teammate asked into another AI teammate's or Copilot's chat can use ${ASK_USER_TOOL_NAME}. Ask the user directly in your reply.`,
});

// An asked agent's chat has no user in it, so only that chat gets a way to reach the user; OpenCode lists a folder's tools once for every chat in it, so the call decides there.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/945
// No agent can be asked while none exists, so a shared listing then leaves it out; a chat the user sees that calls it there is told to ask directly, which isn't an error.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/987
export function createAskUserTool(chats: HiddenAgentChats, host: AskAgentToolHost): HostedTool {
  return {
    definition: ASK_USER_TOOL,
    turnedOffText: UNAVAILABLE_TEXT,
    listedAs: ({ sessionKey, shared }: ToolListing) =>
      getCustomAgentsGate() === "full" &&
      (shared ? host.agents().length > 0 : host.isUnlistedChat(sessionKey))
        ? ASK_USER_TOOL
        : null,
    call: async (args, chat) => {
      const { question } = (args ?? {}) as Record<string, unknown>;
      if (typeof question !== "string" || !question.trim()) {
        return { text: "question must be a non-empty string.", isError: true };
      }
      const result = chats.askUser(chat, question);
      return { text: ASK_USER_RESULT_TEXT[result], isError: result === "unavailable" };
    },
  };
}

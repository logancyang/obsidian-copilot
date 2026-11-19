import type { ChatStateHost } from "@/agentMode/session/chatExtension";
import type {
  HostedTool,
  McpToolDefinition,
  ToolListing,
} from "@/agentMode/session/copilotMcpServer";
import { readAgentDraft, showAgentDraft } from "@/agents/agentMode/agentDraftCard";
import { getCustomAgentsGate } from "@/agents/customAgentsGate";

export const DRAFT_AGENT_TOOL_NAME = "draft_agent";
const UNAVAILABLE_TEXT = "Custom agents aren't available right now. Tell the user.";

export interface DraftAgentToolHost {
  isUnlistedChat: (sessionKey: string) => boolean;
  isCopilotChat: (sessionKey: string) => boolean;
  agentOfCaller: (chat: ChatStateHost | null) => string | null;
}

// OpenCode's Code Mode catalog shows only the first ~120 characters of a description, so the opening carries when to call it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/941
const DRAFT_AGENT_TOOL: McpToolDefinition = Object.freeze({
  name: DRAFT_AGENT_TOOL_NAME,
  description: `Show the user a draft of a new custom agent when they ask you to make one or to change the draft you showed. The user reviews it, picks a face and a model, and creates it; you can't create an agent yourself, even if asked, and never write its files.

Before the first draft, check the other agents listed for you: if you or one of them already handles the job, say so and ask whether they want a new one anyway, and call this only after they say yes.

Write the instruction to the new agent in the second person, in the user's language: what it handles, where things live in the vault, how it should answer. Keep the name short.

Each call replaces the card shown earlier in this chat, so to change the draft, call again with the whole new draft. The call returns at once; don't repeat the draft in your reply.`,
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "The new agent's name, usually one word." },
      title: { type: "string", description: "One line under the name that says what it does." },
      instruction: {
        type: "string",
        description: "What the new agent reads at the start of every chat.",
      },
    },
    required: ["name", "title", "instruction"],
  },
  // Codex asks the user to approve MCP calls unless the tool is read-only, and showing a draft changes nothing.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/941
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  // Claude Code defers MCP tools behind tool search, hiding the description that says when to call it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/941
  _meta: { "anthropic/alwaysLoad": true },
});

export function createDraftAgentTool(host: DraftAgentToolHost): HostedTool {
  return {
    definition: DRAFT_AGENT_TOOL,
    turnedOffText: UNAVAILABLE_TEXT,
    // Only a custom agent drafts, from a chat the user sees; OpenCode lists tools once per folder, so its listing can't tell and the call checks again.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/941
    listedAs: ({ sessionKey }: ToolListing) =>
      getCustomAgentsGate() !== "full" ||
      host.isUnlistedChat(sessionKey) ||
      host.isCopilotChat(sessionKey)
        ? null
        : DRAFT_AGENT_TOOL,
    call: async (args, chat) => {
      const draft = readAgentDraft(args);
      if (!draft) {
        return {
          text: "name must be a non-empty string, and title and instruction must be strings.",
          isError: true,
        };
      }
      if (getCustomAgentsGate() !== "full") return { text: UNAVAILABLE_TEXT, isError: false };
      const draftedBy = host.agentOfCaller(chat);
      if (!chat || !draftedBy) {
        return {
          text: `Only a custom agent can draft an agent, in its own chat. Don't call ${DRAFT_AGENT_TOOL_NAME} again.`,
          isError: false,
        };
      }
      showAgentDraft(chat, draft, draftedBy);
      return {
        text: `Shown to the user as a card below your reply, replacing any earlier draft in this chat. Nothing is created until they review it and press Create.`,
        isError: false,
      };
    },
  };
}

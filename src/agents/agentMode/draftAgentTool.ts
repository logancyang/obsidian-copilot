import type { ChatStateHost } from "@/agentMode/session/chatExtension";
import type {
  HostedTool,
  McpToolDefinition,
  ToolListing,
} from "@/agentMode/session/copilotMcpServer";
import { readAgentDraft, showAgentDraft } from "@/agents/agentMode/agentDraftCard";
import { AI_TEAMMATE_DEFINITION, mayReachCopilotChat } from "@/agents/agentSessionPrompt";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { getCustomAgentsGate } from "@/agents/customAgentsGate";

export const DRAFT_AGENT_TOOL_NAME = "draft_teammate";
const UNAVAILABLE_TEXT = "Copilot Teammates isn't available right now. Tell the user.";

export interface DraftAgentToolHost {
  isUnlistedChat: (sessionKey: string) => boolean;
  agents: () => readonly Pick<CustomAgent, "slug">[];
  callerOf: (chat: ChatStateHost | null) => { agent: string | null } | null;
}

// OpenCode's Code Mode catalog shows only the first ~120 characters of a description, so the opening carries when to call it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/941
const DRAFT_AGENT_TOOL = Object.freeze({
  name: DRAFT_AGENT_TOOL_NAME,
  description: `Show the user a draft of a new AI teammate when they ask you to make one or to change the draft you showed. The user reviews it, picks a face and a model, and creates it; you can't create an AI teammate yourself, even if asked, and never write its files.

Before the first draft, check the other AI teammates listed for you, if any: if you or one of them already handles the job, say so and ask whether they want a new one anyway, and call this only after they say yes.

Write the instruction to the new AI teammate in the second person, in the user's language: what it handles, where things live in the vault, how it should answer. Keep the name short.

Each call replaces the card shown earlier in this chat, so to change the draft, call again with the whole new draft. The call returns at once; don't repeat the draft in your reply.`,
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "The new AI teammate's name, usually one word." },
      title: { type: "string", description: "One line under the name that says what it does." },
      instruction: {
        type: "string",
        description: "What the new AI teammate reads at the start of every chat.",
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
}) satisfies McpToolDefinition;

const DRAFT_AGENT_PROMPT_HINT =
  "When the user asks you to make a new AI teammate, draft it with the draft_teammate tool from obsidian-copilot, which shows them a card to review and create it. If you or an AI teammate already handles that job, say so and ask before drafting. You can't create an AI teammate yourself.";

const DEFINING_DRAFT_AGENT_TOOL: McpToolDefinition = Object.freeze({
  ...DRAFT_AGENT_TOOL,
  description: `${AI_TEAMMATE_DEFINITION} ${DRAFT_AGENT_TOOL.description}`,
});

export function createDraftAgentTool(host: DraftAgentToolHost): HostedTool {
  // ask_teammate opens with the definition in every listing that can reach a Copilot chat and offers it, so this tool does only when there is no teammate to ask.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/999
  const defines = (listing: ToolListing) =>
    mayReachCopilotChat(listing) && host.agents().length === 0;
  return {
    definition: DRAFT_AGENT_TOOL,
    turnedOffText: UNAVAILABLE_TEXT,
    // Only a chat the user sees drafts, with or without a custom agent; OpenCode lists tools once per folder, so its listing can't tell a hidden chat and the call checks again.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/941
    listedAs: (listing: ToolListing) => {
      if (getCustomAgentsGate() !== "full" || host.isUnlistedChat(listing.sessionKey)) return null;
      return defines(listing) ? DEFINING_DRAFT_AGENT_TOOL : DRAFT_AGENT_TOOL;
    },
    promptHint: (listing) =>
      defines(listing)
        ? `${AI_TEAMMATE_DEFINITION} ${DRAFT_AGENT_PROMPT_HINT}`
        : DRAFT_AGENT_PROMPT_HINT,
    call: async (args, chat) => {
      const draft = readAgentDraft(args);
      if (!draft) {
        return {
          text: "name must be a non-empty string, and title and instruction must be strings.",
          isError: true,
        };
      }
      if (getCustomAgentsGate() !== "full") return { text: UNAVAILABLE_TEXT, isError: false };
      const caller = host.callerOf(chat);
      if (!chat || !caller) {
        return {
          text: `Only a chat the user sees can draft an AI teammate. Don't call ${DRAFT_AGENT_TOOL_NAME} again.`,
          isError: false,
        };
      }
      showAgentDraft(chat, draft, caller.agent);
      return {
        text: `Shown to the user as a card below your reply, replacing any earlier draft in this chat. Nothing is created until they review it and press Create.`,
        isError: false,
      };
    },
  };
}

import type { AskedConversation } from "@/agentMode/session/AgentSessionIndex";
import type { ChatStateHost } from "@/agentMode/session/chatExtension";
import type {
  HostedTool,
  McpToolDefinition,
  ToolListing,
} from "@/agentMode/session/copilotMcpServer";
import { localDate } from "@/agents/agentMemoryFile";
import type { AskAgentToolHost } from "@/agents/agentMode/askAgentTool";
import { LIST_CHATS_PROMPT_HINT } from "@/agents/agentSessionPrompt";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { getCustomAgentsGate } from "@/agents/customAgentsGate";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { isNativeChatId } from "@/utils/nativeChatId";

export const LIST_CHATS_TOOL_NAME = "list_chats";
const UNAVAILABLE_TEXT = "Copilot Teammates isn't available right now. Tell the user.";
// "What have we been working on" and "where did we leave off" need the last weeks, and every listed line is context the agent pays for.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/959
const MAX_LISTED_CHATS = 20;
// Small models search the chat folder for a topic after listing and then answer from another agent's chat, so the result itself repeats the scope.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/959
const OTHER_CHATS =
  "Every other chat note belongs to another AI teammate or to Copilot: unless the user names it, never search, read or cite it.";

// Codex's small model took "read a listed note" to need a chat-reading tool it doesn't have, so the result says how.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/959
const OPEN_A_NOTE = "Open a listed note with your file or shell tools to see what was said.";

// An agent asked from another chat recalls that work in its own chats, from a line per conversation, and nothing else of the chat that asked.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/980
const MAX_LISTED_ASKED_CONVERSATIONS = 10;
const ASKED_CONVERSATIONS =
  "Conversations another AI teammate or Copilot asked you into on the user's behalf, newest first. Your answers went back to the chat that asked: you know only what each line says, and there's no note to open for them.";
const ENDINGS: Record<NonNullable<AskedConversation["ending"]>, string> = {
  finished: "your latest answer",
  stopped: "the user stopped you before you finished; your answer so far",
  didnt_finish: "you didn't finish; your answer so far",
};

export interface EarlierChats {
  agent: string | null;
  chats: ChatHistoryItem[];
  askedConversations: readonly AskedConversation[];
  agents: readonly Pick<CustomAgent, "slug" | "name">[];
}

export interface ListChatsToolHost extends AskAgentToolHost {
  earlierChats: (chat: ChatStateHost | null) => Promise<EarlierChats | null>;
  vaultBase: () => string;
}

const LIST_CHATS_TOOL: McpToolDefinition = Object.freeze({
  name: LIST_CHATS_TOOL_NAME,
  description:
    "List your earlier chats with the user when the user asks about earlier chats: newest first, each with its date, title and note path when it was saved as a note.",
  inputSchema: { type: "object", properties: {} },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  _meta: { "anthropic/alwaysLoad": true },
});

// A run that never ended, as when Obsidian closed mid-run, reads as not finished, and an asker deleted since shows by its folder name.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/980
function askedLine(conversation: AskedConversation, { chats, agents }: EarlierChats): string {
  const { askedBy, askedIn, latestAnswer } = conversation;
  const asker = askedBy
    ? (agents.find((agent) => agent.slug === askedBy)?.name ?? askedBy)
    : "Copilot";
  const chat = chats.find(
    (item) => item.backendId === askedIn.backendId && item.sessionId === askedIn.sessionId
  );
  const where = chat ? `"${chat.title}"` : "a chat that's no longer listed";
  const answer = latestAnswer ? `"${latestAnswer}"` : "none";
  return [
    `- ${localDate(new Date(conversation.lastAtMs))}`,
    `${asker} asked you in ${where}`,
    `times asked: ${conversation.asks}`,
    `first ask: "${conversation.firstAsk}"`,
    `${ENDINGS[conversation.ending ?? "didnt_finish"]}: ${answer}`,
  ].join(" · ");
}

export function createListChatsTool(host: ListChatsToolHost): HostedTool {
  return {
    definition: LIST_CHATS_TOOL,
    turnedOffText: UNAVAILABLE_TEXT,
    // Only an agent's own chat has earlier chats with the user to recall; OpenCode lists a folder's tools for every chat in it, so there it is listed while any agent exists and the call turns the other chats down.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/987
    listedAs: ({ sessionKey, shared, agentSlug }: ToolListing) =>
      getCustomAgentsGate() === "full" &&
      (shared
        ? host.agents().length > 0
        : agentSlug !== undefined && !host.isUnlistedChat(sessionKey))
        ? LIST_CHATS_TOOL
        : null,
    promptHint: LIST_CHATS_PROMPT_HINT,
    call: async (_args, chat) => {
      if (getCustomAgentsGate() !== "full") return { text: UNAVAILABLE_TEXT, isError: false };
      const caller = await host.earlierChats(chat);
      if (!caller?.agent) {
        return {
          text: `This chat can't list earlier chats. Don't call ${LIST_CHATS_TOOL_NAME} again.`,
          isError: false,
        };
      }
      // Archiving a chat or its project means the user is done talking there, not that the agent should forget it, so archived chats are listed too.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/959
      const allChats = caller.chats
        .filter((item) => (item.agent ?? null) === caller.agent)
        .sort((a, b) => b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime());
      const chats = allChats.slice(0, MAX_LISTED_CHATS);
      // Past the limit the teammate's own older chats are unlisted too, so the scope can't call them someone else's and a topic missing from the list isn't proof it was never discussed.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/990
      const scope =
        allChats.length > chats.length
          ? `Older chats of yours left out of this list: ${allChats.length - chats.length}. Every other chat note is one of those or belongs to another AI teammate or to Copilot: unless the user names it, never search, read or cite it. If none listed covers the question, say it may be in an older chat you can read if the user names it, not that you haven't discussed it.`
          : OTHER_CHATS;
      const lines = chats.map((item) => {
        const note = isNativeChatId(item.id)
          ? "not saved as a note, so only its title and date are known"
          : `${host.vaultBase()}/${item.id}`;
        return `- ${localDate(item.lastAccessedAt)} · ${item.title} · ${note}`;
      });
      const ownChats =
        chats.length === 0
          ? [`You have no earlier chats with the user. ${OTHER_CHATS}`]
          : [`Your earlier chats with the user, newest first. ${OPEN_A_NOTE} ${scope}`, ...lines];
      const asked = caller.askedConversations
        .filter((conversation) => conversation.agent === caller.agent)
        .sort((a, b) => b.lastAtMs - a.lastAtMs)
        .slice(0, MAX_LISTED_ASKED_CONVERSATIONS)
        .map((conversation) => askedLine(conversation, caller));
      // An agent never asked into another chat gets the same result as before, word for word.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/980
      return {
        text: [...ownChats, ...(asked.length > 0 ? ["", ASKED_CONVERSATIONS, ...asked] : [])].join(
          "\n"
        ),
        isError: false,
      };
    },
  };
}

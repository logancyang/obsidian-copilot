import type { AskedConversation } from "@/agentMode/session/AgentSessionIndex";
import type { ChatStateHost } from "@/agentMode/session/chatExtension";
import type { HostedTool, McpToolDefinition } from "@/agentMode/session/copilotMcpServer";
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
function otherChats(agent: string | null): string {
  return `Every other chat note belongs to ${agent ? "another agent or to Copilot" : "one of the user's agents"}: unless the user names it, never search, read or cite it.`;
}

// Codex's small model took "read a listed note" to need a chat-reading tool it doesn't have, so the result says how.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/959
const OPEN_A_NOTE = "Open a listed note with your file or shell tools to see what was said.";

// An agent asked from another chat recalls that work in its own chats, from a line per conversation, and nothing else of the chat that asked.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/980
const MAX_LISTED_ASKED_CONVERSATIONS = 10;
const ASKED_CONVERSATIONS =
  "Conversations another agent or Copilot asked you into on the user's behalf, newest first. Your answers went back to the chat that asked: you know only what each line says, and there's no note to open for them.";
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

export interface ListChatsToolHost {
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

function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

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
    // An asked agent's hidden chat that called list_chats without having it reported a missing Copilot tool, so it gets the tool and the call tells it that chat has no earlier chats.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/959
    listedAs: () => (getCustomAgentsGate() === "full" ? LIST_CHATS_TOOL : null),
    promptHint: LIST_CHATS_PROMPT_HINT,
    call: async (_args, chat) => {
      if (getCustomAgentsGate() !== "full") return { text: UNAVAILABLE_TEXT, isError: false };
      const caller = await host.earlierChats(chat);
      if (!caller) {
        return {
          text: `Another agent asked you into this chat, so it has no earlier chats with the user. Say so, and don't call ${LIST_CHATS_TOOL_NAME} again.`,
          isError: false,
        };
      }
      // Archiving a chat or its project means the user is done talking there, not that the agent should forget it, so archived chats are listed too.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/959
      const chats = caller.chats
        .filter((item) => (item.agent ?? null) === caller.agent)
        .sort((a, b) => b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime())
        .slice(0, MAX_LISTED_CHATS);
      const lines = chats.map((item) => {
        const note = isNativeChatId(item.id)
          ? "not saved as a note, so only its title and date are known"
          : `${host.vaultBase()}/${item.id}`;
        return `- ${localDate(item.lastAccessedAt)} · ${item.title} · ${note}`;
      });
      const ownChats =
        chats.length === 0
          ? [`You have no earlier chats with the user. ${otherChats(caller.agent)}`]
          : [
              `Your earlier chats with the user, newest first. ${OPEN_A_NOTE} ${otherChats(caller.agent)}`,
              ...lines,
            ];
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

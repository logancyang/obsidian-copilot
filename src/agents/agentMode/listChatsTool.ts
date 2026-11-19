import type { ChatStateHost } from "@/agentMode/session/chatExtension";
import type { HostedTool, McpToolDefinition } from "@/agentMode/session/copilotMcpServer";
import { getCustomAgentsGate } from "@/agents/customAgentsGate";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { isNativeChatId } from "@/utils/nativeChatId";

export const LIST_CHATS_TOOL_NAME = "list_chats";
const UNAVAILABLE_TEXT = "Custom agents aren't available right now. Tell the user.";
// "What have we been working on" and "where did we leave off" need the last weeks, and every listed line is context the agent pays for.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/959
const MAX_LISTED_CHATS = 20;
// Small models search the chat folder for a topic after listing and then answer from another agent's chat, so the result itself repeats the scope.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/959
function otherChats(agent: string | null): string {
  return `Every other chat note belongs to ${agent ? "another agent or to Copilot" : "a custom agent"}: unless the user names it, never search, read or cite it.`;
}

// Codex's small model took "read a listed note" to need a chat-reading tool it doesn't have, so the result says how.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/959
const OPEN_A_NOTE = "Open a listed note with your file or shell tools to see what was said.";

export interface EarlierChats {
  agent: string | null;
  chats: ChatHistoryItem[];
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

export function createListChatsTool(host: ListChatsToolHost): HostedTool {
  return {
    definition: LIST_CHATS_TOOL,
    turnedOffText: UNAVAILABLE_TEXT,
    // An asked agent's hidden chat reads the shared prompt that names list_chats too, and without the tool it reported a missing Copilot tool; it gets the tool and the call tells it that chat has no earlier chats.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/959
    listedAs: () => (getCustomAgentsGate() === "full" ? LIST_CHATS_TOOL : null),
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
      if (chats.length === 0) {
        return {
          text: `You have no earlier chats with the user. ${otherChats(caller.agent)}`,
          isError: false,
        };
      }
      const lines = chats.map((item) => {
        const note = isNativeChatId(item.id)
          ? "not saved as a note, so only its title and date are known"
          : `${host.vaultBase()}/${item.id}`;
        return `- ${localDate(item.lastAccessedAt)} · ${item.title} · ${note}`;
      });
      return {
        text: [
          `Your earlier chats with the user, newest first. ${OPEN_A_NOTE} ${otherChats(caller.agent)}`,
          ...lines,
        ].join("\n"),
        isError: false,
      };
    },
  };
}

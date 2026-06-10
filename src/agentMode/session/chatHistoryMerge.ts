import { USER_SENDER } from "@/constants";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { buildNativeChatId } from "@/utils/nativeChatId";
import type { AgentSessionIndexEntry } from "./AgentSessionIndex";
import type { AgentChatMessage } from "./types";

/**
 * A markdown-persisted chat plus the backend session identity from its
 * frontmatter (absent for chats saved before resume was wired up, whose
 * native twin therefore can't be matched).
 */
export interface MarkdownChatEntry {
  item: ChatHistoryItem;
  backendId?: string;
  sessionId?: string;
}

/** Last-resort row title when a native session has no title to show at all. */
export const UNTITLED_NATIVE_CHAT = "Untitled chat";

/** Max length of a title derived from the first user message before eliding. */
const MAX_DERIVED_TITLE_CHARS = 60;

/**
 * Derive a readable title from a chat's first user message, mirroring what the
 * markdown autosave path already does for note filenames. Used as the native
 * index title when no agent-generated label exists yet — notably for Claude
 * Code, whose SDK exposes no session-title API, so without this every CC chat
 * in recent history would read "Untitled chat". Stored as an overridable
 * (agent-sourced) title so an opencode/codex summarizer title still wins later.
 * Returns null when there's no usable user text.
 */
export function deriveChatTitleFromMessages(messages: AgentChatMessage[]): string | null {
  const firstUser = messages.find((m) => m.sender === USER_SENDER && m.message.trim());
  if (!firstUser) return null;
  const text = firstUser.message
    .replace(/\[\[([^\]]+)\]\]/g, "$1") // show wikilink target text, not the brackets
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  if (text.length <= MAX_DERIVED_TITLE_CHARS) return text;
  return `${text.slice(0, MAX_DERIVED_TITLE_CHARS).trimEnd()}…`;
}

/**
 * Merge markdown-saved chats with native-store sessions into one de-duplicated
 * history list. Identity is `backendId + sessionId`: a session that was also
 * autosaved as markdown appears once, as the markdown item (it carries the
 * user-facing title and the openable source note), with its recency lifted to
 * whichever side was touched last. Native-only sessions become synthetic items
 * whose id encodes the (backendId, sessionId) pair for the resume router.
 *
 * Ordering is left to the consumers (the popover and the landing section each
 * apply their own sort strategy), matching `getChatHistoryItems`'s existing
 * contract of returning unsorted items.
 */
export function mergeChatHistoryItems(
  markdownEntries: MarkdownChatEntry[],
  nativeEntries: AgentSessionIndexEntry[]
): ChatHistoryItem[] {
  const nativeByKey = new Map<string, AgentSessionIndexEntry>();
  for (const entry of nativeEntries) {
    nativeByKey.set(`${entry.backendId}:${entry.sessionId}`, entry);
  }

  const merged: ChatHistoryItem[] = [];
  for (const { item, backendId, sessionId } of markdownEntries) {
    const key = backendId && sessionId ? `${backendId}:${sessionId}` : null;
    const twin = key ? nativeByKey.get(key) : undefined;
    if (twin && key) {
      nativeByKey.delete(key);
      if (twin.lastAccessedAtMs > item.lastAccessedAt.getTime()) {
        merged.push({ ...item, lastAccessedAt: new Date(twin.lastAccessedAtMs) });
        continue;
      }
    }
    merged.push(item);
  }

  for (const entry of nativeByKey.values()) {
    merged.push({
      id: buildNativeChatId(entry.backendId, entry.sessionId),
      title: entry.title ?? UNTITLED_NATIVE_CHAT,
      createdAt: new Date(entry.createdAtMs),
      lastAccessedAt: new Date(entry.lastAccessedAtMs),
      backendId: entry.backendId,
    });
  }

  return merged;
}

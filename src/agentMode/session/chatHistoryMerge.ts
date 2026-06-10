import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { buildNativeChatId, type AgentSessionIndexEntry } from "./AgentSessionIndex";

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

/** Fallback row title for a native session the backend never titled. */
export const UNTITLED_NATIVE_CHAT = "Untitled chat";

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

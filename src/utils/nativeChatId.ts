/**
 * Id scheme for recent-chats entries that live only in a backend's native
 * session store (no markdown note to use as the id). Kept dependency-free in
 * the host layer (directly under `src/agentMode/`, NOT in the barrel or
 * `session/`) because `main.ts` routes these ids at load time on every
 * platform — importing the `@/agentMode` barrel there would pull Node-only
 * modules into the mobile bundle and crash a Node-less runtime.
 */

/** `ChatHistoryItem.id` prefix marking a native-store (no markdown file) entry. */
export const NATIVE_CHAT_ID_PREFIX = "copilot-agent-session://";

/** Encode a (backendId, sessionId) pair as a history-item id. */
export function buildNativeChatId(backendId: string, sessionId: string): string {
  return `${NATIVE_CHAT_ID_PREFIX}${backendId}/${encodeURIComponent(sessionId)}`;
}

export function isNativeChatId(id: string): boolean {
  return id.startsWith(NATIVE_CHAT_ID_PREFIX);
}

/** Inverse of {@link buildNativeChatId}. Returns null for malformed ids. */
export function parseNativeChatId(id: string): { backendId: string; sessionId: string } | null {
  if (!isNativeChatId(id)) return null;
  const rest = id.slice(NATIVE_CHAT_ID_PREFIX.length);
  const sep = rest.indexOf("/");
  if (sep <= 0 || sep === rest.length - 1) return null;
  try {
    return {
      backendId: rest.slice(0, sep),
      sessionId: decodeURIComponent(rest.slice(sep + 1)),
    };
  } catch {
    return null;
  }
}

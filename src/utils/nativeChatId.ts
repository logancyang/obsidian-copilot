const NATIVE_CHAT_ID_PREFIX = "copilot-agent-session://";

export function buildNativeChatId(backendId: string, sessionId: string): string {
  return `${NATIVE_CHAT_ID_PREFIX}${backendId}/${encodeURIComponent(sessionId)}`;
}

export function isNativeChatId(id: string): boolean {
  return id.startsWith(NATIVE_CHAT_ID_PREFIX);
}

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

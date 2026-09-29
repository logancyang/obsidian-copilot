import { logWarn } from "@/logger";
import type { App } from "obsidian";

// Agent session ids exist only in this device's agent stores, so the record is kept in
// vault-scoped local storage and never in synced settings or vault files.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/607
export const OPEN_CHAT_RECORD_STORAGE_KEY = "copilot:agent-open-chats:v1";

export interface OpenChatEntry {
  backendId: string;
  sessionId: string;
  sourcePath?: string;
  active: boolean;
}

const EMPTY_OPEN_CHATS: readonly OpenChatEntry[] = Object.freeze([]);

function isOpenChatEntry(value: unknown): value is OpenChatEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.backendId === "string" &&
    entry.backendId.length > 0 &&
    typeof entry.sessionId === "string" &&
    entry.sessionId.length > 0 &&
    (entry.sourcePath === undefined || typeof entry.sourcePath === "string") &&
    typeof entry.active === "boolean"
  );
}

/**
 * Keeps the list of open global-scope agent chats, and which one was active, in local storage so
 * they can be reopened at startup. It stores and returns the list only; opening the chats belongs
 * to the session manager.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/607
 */
export class OpenChatRecordStore {
  private lastSignature: string | null = null;

  constructor(private readonly app: Pick<App, "loadLocalStorage" | "saveLocalStorage">) {}

  load(): readonly OpenChatEntry[] {
    let raw: unknown;
    try {
      raw = this.app.loadLocalStorage(OPEN_CHAT_RECORD_STORAGE_KEY);
    } catch (e) {
      logWarn("[AgentMode] could not read the open-chat record", e);
      return EMPTY_OPEN_CHATS;
    }
    if (typeof raw !== "string") return EMPTY_OPEN_CHATS;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return EMPTY_OPEN_CHATS;
      const entries = parsed.filter(isOpenChatEntry);
      this.lastSignature = raw;
      return entries.length === 0 ? EMPTY_OPEN_CHATS : entries;
    } catch {
      return EMPTY_OPEN_CHATS;
    }
  }

  save(entries: readonly OpenChatEntry[]): void {
    const signature = JSON.stringify(entries);
    if (signature === this.lastSignature) return;
    try {
      this.app.saveLocalStorage(OPEN_CHAT_RECORD_STORAGE_KEY, signature);
      this.lastSignature = signature;
    } catch (e) {
      logWarn("[AgentMode] could not write the open-chat record", e);
    }
  }
}

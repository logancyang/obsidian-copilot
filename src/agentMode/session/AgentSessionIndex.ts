import { logWarn } from "@/logger";
import type { BackendId, ModelSelection } from "./types";

export interface AgentSessionIndexEntry {
  backendId: BackendId;
  sessionId: string;
  title: string | null;
  titleSource?: "user" | "agent";
  createdAtMs: number;
  lastAccessedAtMs: number;
  projectId?: string;
  model?: ModelSelection;
  teammate?: string;
}

export interface AskedConversation {
  backendId: BackendId;
  sessionId: string;
  model?: ModelSelection;
  agent: string;
  askedBy?: string;
  askedIn: { backendId: BackendId; sessionId: string };
  firstAtMs: number;
  lastAtMs: number;
  asks: number;
  firstAsk: string;
  latestAnswer?: string;
  ending?: "finished" | "stopped" | "didnt_finish";
}

interface AgentSessionIndexFile {
  version: 1;
  entries: AgentSessionIndexEntry[];
  askedConversations: unknown[];
}

export interface AgentSessionIndexStorage {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
}

const SAVE_DEBOUNCE_MS = 500;
const MAX_ENTRIES = 500;
// Each conversation holds two texts of about 300 characters, about 1 KB in the file, so 100 add at most about as much as the 500 chats.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/980
const MAX_ASKED_CONVERSATIONS = 100;
const ENDINGS: ReadonlySet<unknown> = new Set(["finished", "stopped", "didnt_finish"]);

function entryKey(backendId: string, sessionId: string): string {
  return `${backendId}:${sessionId}`;
}

function sanitizeEntry(raw: unknown): AgentSessionIndexEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.backendId !== "string" || !r.backendId.trim()) return null;
  if (typeof r.sessionId !== "string" || !r.sessionId.trim()) return null;
  const createdAtMs = typeof r.createdAtMs === "number" && r.createdAtMs > 0 ? r.createdAtMs : null;
  const lastAccessedAtMs =
    typeof r.lastAccessedAtMs === "number" && r.lastAccessedAtMs > 0 ? r.lastAccessedAtMs : null;
  if (!createdAtMs && !lastAccessedAtMs) return null;
  const title = typeof r.title === "string" && r.title.trim() ? r.title.trim() : null;
  return {
    backendId: r.backendId,
    sessionId: r.sessionId,
    title,
    titleSource:
      title && (r.titleSource === "user" || r.titleSource === "agent") ? r.titleSource : undefined,
    createdAtMs: createdAtMs ?? lastAccessedAtMs!,
    lastAccessedAtMs: lastAccessedAtMs ?? createdAtMs!,
    projectId: typeof r.projectId === "string" && r.projectId.trim() ? r.projectId : undefined,
    model: sanitizeModel(r.model),
    teammate: typeof r.teammate === "string" && r.teammate ? r.teammate : undefined,
  };
}

function sanitizeAskedConversation(raw: unknown): AskedConversation | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const askedIn = r.askedIn as Record<string, unknown> | null | undefined;
  const strings = [r.backendId, r.sessionId, r.teammate, askedIn?.backendId, askedIn?.sessionId];
  if (strings.some((value) => typeof value !== "string" || !value)) return null;
  const numbers = [r.firstAtMs, r.lastAtMs, r.asks];
  if (numbers.some((value) => typeof value !== "number") || typeof r.firstAsk !== "string") {
    return null;
  }
  return {
    backendId: r.backendId as BackendId,
    sessionId: r.sessionId as string,
    model: sanitizeModel(r.model),
    agent: r.teammate as string,
    askedBy: typeof r.askedBy === "string" && r.askedBy ? r.askedBy : undefined,
    askedIn: {
      backendId: askedIn!.backendId as BackendId,
      sessionId: askedIn!.sessionId as string,
    },
    firstAtMs: r.firstAtMs as number,
    lastAtMs: r.lastAtMs as number,
    asks: r.asks as number,
    firstAsk: r.firstAsk,
    latestAnswer: typeof r.latestAnswer === "string" ? r.latestAnswer : undefined,
    ending: ENDINGS.has(r.ending) ? (r.ending as AskedConversation["ending"]) : undefined,
  };
}

function keepNewest<T>(
  items: Map<string, T>,
  max: number,
  at: (item: T) => number
): Map<string, T> {
  if (items.size <= max) return items;
  return new Map(
    Array.from(items)
      .sort(([, a], [, b]) => at(b) - at(a))
      .slice(0, max)
  );
}

export function sanitizeModel(raw: unknown): ModelSelection | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { baseModelId, effort } = raw as Record<string, unknown>;
  if (typeof baseModelId !== "string" || !baseModelId) return undefined;
  return { baseModelId, effort: typeof effort === "string" ? effort : null };
}

export class AgentSessionIndex {
  private entries = new Map<string, AgentSessionIndexEntry>();
  private askedConversations = new Map<string, AskedConversation>();
  private loadPromise: Promise<void> | null = null;
  private saveTimer: number | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: AgentSessionIndexStorage,
    private readonly filePath: string
  ) {}

  async getEntries(): Promise<AgentSessionIndexEntry[]> {
    await this.ensureLoaded();
    return Array.from(this.entries.values());
  }

  async getEntry(backendId: BackendId, sessionId: string): Promise<AgentSessionIndexEntry | null> {
    await this.ensureLoaded();
    return this.entries.get(entryKey(backendId, sessionId)) ?? null;
  }

  async recordSession(entry: AgentSessionIndexEntry): Promise<void> {
    await this.ensureLoaded();
    const key = entryKey(entry.backendId, entry.sessionId);
    const existing = this.entries.get(key);
    const keepExistingTitle = entry.title == null;
    this.entries.set(key, {
      backendId: entry.backendId,
      sessionId: entry.sessionId,
      title: keepExistingTitle ? (existing?.title ?? null) : entry.title,
      titleSource: keepExistingTitle ? existing?.titleSource : entry.titleSource,
      createdAtMs: Math.min(entry.createdAtMs, existing?.createdAtMs ?? entry.createdAtMs),
      lastAccessedAtMs: Math.max(
        entry.lastAccessedAtMs,
        existing?.lastAccessedAtMs ?? entry.lastAccessedAtMs
      ),
      projectId: entry.projectId ?? existing?.projectId,
      model: entry.model ?? existing?.model,
      teammate: entry.teammate ?? existing?.teammate,
    });
    this.scheduleSave();
  }

  async setTitle(backendId: BackendId, sessionId: string, title: string): Promise<void> {
    await this.ensureLoaded();
    const key = entryKey(backendId, sessionId);
    const existing = this.entries.get(key);
    if (!existing) return;
    const trimmed = title.trim();
    this.entries.set(key, {
      ...existing,
      title: trimmed || null,
      titleSource: trimmed ? "user" : undefined,
    });
    this.scheduleSave();
  }

  async touch(backendId: BackendId, sessionId: string): Promise<void> {
    await this.ensureLoaded();
    const key = entryKey(backendId, sessionId);
    const existing = this.entries.get(key);
    if (!existing) return;
    this.entries.set(key, { ...existing, lastAccessedAtMs: Date.now() });
    this.scheduleSave();
  }

  async deleteSession(backendId: BackendId, sessionId: string): Promise<void> {
    await this.ensureLoaded();
    this.entries.delete(entryKey(backendId, sessionId));
    // An agent asked from a deleted chat forgets what it was asked there.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/980
    this.dropAskedConversations(
      ({ askedIn }) => askedIn.backendId === backendId && askedIn.sessionId === sessionId
    );
    this.scheduleSave();
  }

  async getAskedConversations(): Promise<AskedConversation[]> {
    await this.ensureLoaded();
    return Array.from(this.askedConversations.values());
  }

  async updateAskedConversation(
    backendId: BackendId,
    sessionId: string,
    change: (known: AskedConversation | undefined) => AskedConversation | undefined
  ): Promise<void> {
    await this.ensureLoaded();
    const key = entryKey(backendId, sessionId);
    const next = change(this.askedConversations.get(key));
    if (!next) return;
    this.askedConversations.set(key, next);
    this.scheduleSave();
  }

  async deleteAskedConversations(
    match: (conversation: AskedConversation) => boolean
  ): Promise<void> {
    await this.ensureLoaded();
    this.dropAskedConversations(match);
    this.scheduleSave();
  }

  private dropAskedConversations(match: (conversation: AskedConversation) => boolean): void {
    for (const [key, conversation] of Array.from(this.askedConversations)) {
      if (match(conversation)) this.askedConversations.delete(key);
    }
  }

  async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.queueWrite();
    }
    await this.writeChain;
  }

  async flushOrThrow(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.queueWrite();
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadFromDisk();
    }
    return this.loadPromise;
  }

  private async loadFromDisk(): Promise<void> {
    try {
      if (!(await this.storage.exists(this.filePath))) return;
      const raw = JSON.parse(
        await this.storage.read(this.filePath)
      ) as Partial<AgentSessionIndexFile> | null;
      if (!raw || typeof raw !== "object") return;
      for (const candidate of Array.isArray(raw.entries) ? raw.entries : []) {
        const entry = sanitizeEntry(candidate);
        if (entry) this.entries.set(entryKey(entry.backendId, entry.sessionId), entry);
      }
      const asked = Array.isArray(raw.askedConversations) ? raw.askedConversations : [];
      for (const candidate of asked) {
        const conversation = sanitizeAskedConversation(candidate);
        if (conversation) {
          this.askedConversations.set(
            entryKey(conversation.backendId, conversation.sessionId),
            conversation
          );
        }
      }
    } catch (e) {
      logWarn(`[AgentMode] failed to load agent session index at ${this.filePath}`, e);
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.queueWrite();
    }, SAVE_DEBOUNCE_MS);
  }

  private queueWrite(): Promise<void> {
    const snapshot = this.serialize();
    const write = this.writeChain.then(() => this.storage.write(this.filePath, snapshot));
    this.writeChain = write.catch((e) => {
      logWarn(`[AgentMode] failed to write agent session index at ${this.filePath}`, e);
    });
    return write;
  }

  private serialize(): string {
    this.entries = keepNewest(this.entries, MAX_ENTRIES, (e) => e.lastAccessedAtMs);
    this.askedConversations = keepNewest(
      this.askedConversations,
      MAX_ASKED_CONVERSATIONS,
      (c) => c.lastAtMs
    );
    const file: AgentSessionIndexFile = {
      version: 1,
      entries: Array.from(this.entries.values()),
      // The file names the asked teammate teammate, while the code still calls it agent.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/1000
      askedConversations: Array.from(this.askedConversations.values(), ({ agent, ...rest }) => ({
        ...rest,
        teammate: agent,
      })),
    };
    return JSON.stringify(file, null, 2);
  }
}

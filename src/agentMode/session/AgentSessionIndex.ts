import { logWarn } from "@/logger";
import type { BackendId } from "./types";

export interface AgentSessionIndexEntry {
  backendId: BackendId;
  sessionId: string;
  title: string | null;
  titleSource?: "user" | "agent";
  createdAtMs: number;
  lastAccessedAtMs: number;
  projectId?: string;
}

interface AgentSessionIndexFile {
  version: 1;
  entries: AgentSessionIndexEntry[];
  tombstones: Record<string, number>;
}

export interface AgentSessionIndexStorage {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
}

const SAVE_DEBOUNCE_MS = 500;
const MAX_ENTRIES = 500;
const MAX_TOMBSTONES = 500;

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
  };
}

export class AgentSessionIndex {
  private entries = new Map<string, AgentSessionIndexEntry>();
  private tombstones = new Map<string, number>();
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
    this.tombstones.delete(key);
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
    });
    this.scheduleSave();
  }

  async mergeDiscoveredSessions(entries: AgentSessionIndexEntry[]): Promise<void> {
    await this.ensureLoaded();
    let changed = false;
    for (const entry of entries) {
      const key = entryKey(entry.backendId, entry.sessionId);
      if (this.tombstones.has(key)) continue;
      const existing = this.entries.get(key);
      const keepExistingTitle = existing?.titleSource === "user" || entry.title == null;
      const next: AgentSessionIndexEntry = {
        backendId: entry.backendId,
        sessionId: entry.sessionId,
        title: keepExistingTitle ? (existing?.title ?? null) : entry.title,
        titleSource: keepExistingTitle ? existing?.titleSource : "agent",
        createdAtMs: Math.min(entry.createdAtMs, existing?.createdAtMs ?? entry.createdAtMs),
        lastAccessedAtMs: Math.max(
          entry.lastAccessedAtMs,
          existing?.lastAccessedAtMs ?? entry.lastAccessedAtMs
        ),
        projectId: existing?.projectId ?? entry.projectId,
      };
      if (
        !existing ||
        existing.title !== next.title ||
        existing.createdAtMs !== next.createdAtMs ||
        existing.lastAccessedAtMs !== next.lastAccessedAtMs ||
        existing.projectId !== next.projectId
      ) {
        this.entries.set(key, next);
        changed = true;
      }
    }
    if (changed) this.scheduleSave();
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
    const key = entryKey(backendId, sessionId);
    this.entries.delete(key);
    this.tombstones.set(key, Date.now());
    this.scheduleSave();
  }

  async isTombstoned(backendId: BackendId, sessionId: string): Promise<boolean> {
    await this.ensureLoaded();
    return this.tombstones.has(entryKey(backendId, sessionId));
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
      if (raw.tombstones && typeof raw.tombstones === "object") {
        for (const [key, value] of Object.entries(raw.tombstones)) {
          if (typeof value === "number" && value > 0) this.tombstones.set(key, value);
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
    let entries = Array.from(this.entries.values());
    if (entries.length > MAX_ENTRIES) {
      entries = entries
        .sort((a, b) => b.lastAccessedAtMs - a.lastAccessedAtMs)
        .slice(0, MAX_ENTRIES);
      this.entries = new Map(entries.map((e) => [entryKey(e.backendId, e.sessionId), e]));
    }
    let tombstonePairs = Array.from(this.tombstones.entries());
    if (tombstonePairs.length > MAX_TOMBSTONES) {
      tombstonePairs = tombstonePairs.sort((a, b) => b[1] - a[1]).slice(0, MAX_TOMBSTONES);
      this.tombstones = new Map(tombstonePairs);
    }
    const file: AgentSessionIndexFile = {
      version: 1,
      entries,
      tombstones: Object.fromEntries(tombstonePairs),
    };
    return JSON.stringify(file, null, 2);
  }
}

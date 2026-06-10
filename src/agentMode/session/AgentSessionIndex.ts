import { logWarn } from "@/logger";
import type { BackendId } from "./types";

/**
 * One resumable agent session known to the plugin, independent of whether a
 * markdown note was saved for it. Recorded write-through as sessions are used
 * (and opportunistically from a backend's native `listSessions`), so the
 * recent-chats list works with `autosaveChat` off and without spawning a
 * backend just to enumerate history.
 */
export interface AgentSessionIndexEntry {
  backendId: BackendId;
  sessionId: string;
  /** Last known user-visible title (agent label or user rename), or null. */
  title: string | null;
  /**
   * Who set `title`. `"user"` titles win over anything a native
   * `listSessions` sweep discovers — the agent store keeps its original
   * title (we never mutate it), so without this marker a plugin-side rename
   * would be clobbered on the next sweep. Mirrors `AgentSession`'s
   * `labelSource` semantics. Absent ≙ agent-sourced / unknown.
   */
  titleSource?: "user" | "agent";
  createdAtMs: number;
  lastAccessedAtMs: number;
}

interface AgentSessionIndexFile {
  version: 1;
  entries: AgentSessionIndexEntry[];
  /**
   * Keys of sessions the user deleted from recent chats, mapped to deletion
   * time. Deleting never touches the backend's own session store (it is
   * shared with the CLI outside Obsidian), so a tombstone is what keeps the
   * entry from resurrecting on the next native `listSessions` merge.
   */
  tombstones: Record<string, number>;
}

/**
 * Minimal file-IO surface the index needs. Production passes the vault
 * `DataAdapter` (paths are vault-relative, so the file lands under
 * `.obsidian/plugins/<id>/`); tests pass an in-memory fake.
 */
export interface AgentSessionIndexStorage {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
}

const SAVE_DEBOUNCE_MS = 500;
/** Keep the on-disk file bounded; prune least-recently-accessed beyond this. */
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
  };
}

/**
 * Plugin-local, per-vault store of resumable Agent Mode sessions plus
 * tombstones for user-deleted ones. This is the source of truth that lets
 * recent chats list a session without a markdown note and without a live
 * backend; native `listSessions` results are merged in as enrichment.
 *
 * All mutators lazily load the file on first use and persist with a short
 * debounce; `flush()` forces a pending write (call it on plugin unload).
 */
export class AgentSessionIndex {
  private entries = new Map<string, AgentSessionIndexEntry>();
  private tombstones = new Map<string, number>();
  private loadPromise: Promise<void> | null = null;
  private saveTimer: number | null = null;
  // Serializes writes so a slow disk can't interleave two snapshots.
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: AgentSessionIndexStorage,
    private readonly filePath: string
  ) {}

  /** All known entries, unsorted. Tombstoned sessions are never present. */
  async getEntries(): Promise<AgentSessionIndexEntry[]> {
    await this.ensureLoaded();
    return Array.from(this.entries.values());
  }

  async getEntry(backendId: BackendId, sessionId: string): Promise<AgentSessionIndexEntry | null> {
    await this.ensureLoaded();
    return this.entries.get(entryKey(backendId, sessionId)) ?? null;
  }

  /**
   * Write-through upsert from live session activity. Clears any tombstone for
   * the key — the user is actively chatting on this session, so a previous
   * delete no longer reflects intent. Keeps the earliest `createdAtMs` and the
   * latest `lastAccessedAtMs`; a null `title` never clobbers a known one.
   */
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
    });
    this.scheduleSave();
  }

  /**
   * Merge sessions discovered via a backend's native `listSessions`. Unlike
   * {@link recordSession} this respects tombstones (a deleted chat must not
   * resurrect just because the backend still stores it), never moves
   * `lastAccessedAtMs` backwards, and never overwrites a user-renamed title
   * — discovered titles are agent-store originals.
   */
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
      };
      if (
        !existing ||
        existing.title !== next.title ||
        existing.createdAtMs !== next.createdAtMs ||
        existing.lastAccessedAtMs !== next.lastAccessedAtMs
      ) {
        this.entries.set(key, next);
        changed = true;
      }
    }
    if (changed) this.scheduleSave();
  }

  /**
   * Rename support for native-only entries (no frontmatter to patch). Marks
   * the title user-sourced so discovered-session merges can't clobber it.
   */
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

  /** Bump `lastAccessedAtMs` (e.g. when the chat is reopened from history). */
  async touch(backendId: BackendId, sessionId: string): Promise<void> {
    await this.ensureLoaded();
    const key = entryKey(backendId, sessionId);
    const existing = this.entries.get(key);
    if (!existing) return;
    this.entries.set(key, { ...existing, lastAccessedAtMs: Date.now() });
    this.scheduleSave();
  }

  /**
   * Remove the entry and tombstone the key so native merges don't bring it
   * back. The backend's own session store is deliberately left untouched.
   * Safe to call for keys that were never indexed (e.g. deleting a markdown
   * chat whose native twin should stay suppressed).
   */
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

  /** Force any pending debounced write to disk. */
  async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.queueWrite();
    }
    await this.writeChain;
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
      // A corrupt index degrades to "no native history" rather than failing
      // the whole recent-chats surface; the next save rewrites a clean file.
      logWarn(`[AgentMode] failed to load agent session index at ${this.filePath}`, e);
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.queueWrite();
    }, SAVE_DEBOUNCE_MS);
  }

  private queueWrite(): void {
    const snapshot = this.serialize();
    this.writeChain = this.writeChain
      .then(() => this.storage.write(this.filePath, snapshot))
      .catch((e) => {
        logWarn(`[AgentMode] failed to write agent session index at ${this.filePath}`, e);
      });
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

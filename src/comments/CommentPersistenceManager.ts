/**
 * CommentPersistenceManager - JSON sidecar storage for inline comments.
 *
 * Layout (under `settings.commentsFolder`, default `copilot/copilot-comments`):
 *   _index.json              -- map<notePath, stableId>
 *   <stableId>.json          -- CommentSidecar for one host note
 *   _archive/<stableId>.json -- sidecar for a deleted host note
 *
 * Writes are debounced per-file (300ms trailing edge) with an explicit
 * `flush()` for lifecycle transitions (popover close, plugin unload, etc.).
 */

import { MD5 } from "crypto-js";
import { normalizePath, type App, TFile } from "obsidian";
import { logError, logWarn } from "@/logger";
import { ensureFolderExists } from "@/utils";
import type { Comment, CommentSidecar } from "./types";

const WRITE_DEBOUNCE_MS = 300;
const INDEX_FILE = "_index.json";
const ARCHIVE_DIR = "_archive";

interface IndexRecord {
  version: 1;
  entries: Record<string, string>;
}

export interface CommentPersistenceManagerOptions {
  app: App;
  /** Folder path relative to the vault root. */
  getFolder: () => string;
}

export class CommentPersistenceManager {
  private app: App;
  private getFolder: () => string;
  private index = new Map<string, string>(); // notePath -> stableId
  private pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();
  private lastWriteMtime = new Map<string, number>();
  private indexWriteTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;

  constructor(opts: CommentPersistenceManagerOptions) {
    this.app = opts.app;
    this.getFolder = opts.getFolder;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const folder = this.getFolder();
    try {
      await ensureFolderExists(folder);
    } catch (error) {
      logWarn("CommentPersistenceManager: failed to ensure folder", error);
    }
    await this.loadIndex();
  }

  getStableIdForNotePath(notePath: string): string | null {
    return this.index.get(notePath) ?? null;
  }

  /** Creates-or-returns a stable ID for a note, registering it in the index. */
  async ensureStableId(notePath: string): Promise<string> {
    const existing = this.index.get(notePath);
    if (existing) return existing;
    const ctime = this.lookupCtime(notePath);
    const id = MD5(`${notePath}|${ctime}`).toString().slice(0, 16);
    this.index.set(notePath, id);
    this.scheduleIndexWrite();
    return id;
  }

  async loadSidecarByNotePath(notePath: string): Promise<CommentSidecar | null> {
    const stableId = this.index.get(notePath);
    if (!stableId) return null;
    return this.loadSidecar(stableId);
  }

  /** Write a sidecar (debounced). */
  scheduleWrite(sidecar: CommentSidecar): void {
    const stableId = sidecar.stableId;
    const existing = this.pendingWrites.get(stableId);
    if (existing) clearTimeout(existing);
    const handle = setTimeout(() => {
      this.pendingWrites.delete(stableId);
      void this.writeSidecarNow(sidecar);
    }, WRITE_DEBOUNCE_MS);
    this.pendingWrites.set(stableId, handle);
  }

  /** Flush all pending writes synchronously. */
  async flush(): Promise<void> {
    const handles = Array.from(this.pendingWrites.entries());
    this.pendingWrites.clear();
    for (const [, handle] of handles) clearTimeout(handle);
    // Without re-fetching the sidecar, we can't flush without caller info.
    // Callers use `writeSidecarNow` directly when immediate flush is required.
    if (this.indexWriteTimer !== null) {
      clearTimeout(this.indexWriteTimer);
      this.indexWriteTimer = null;
      await this.writeIndexNow();
    }
  }

  async writeSidecarNow(sidecar: CommentSidecar): Promise<void> {
    const folder = this.getFolder();
    const filePath = normalizePath(`${folder}/${sidecar.stableId}.json`);
    try {
      await ensureFolderExists(folder);
      const body = JSON.stringify(sidecar, null, 2);
      await this.app.vault.adapter.write(filePath, body);
      this.recordMtime(filePath);
    } catch (error) {
      logError("CommentPersistenceManager: write failed", filePath, error);
    }
  }

  async loadSidecar(stableId: string): Promise<CommentSidecar | null> {
    const filePath = normalizePath(`${this.getFolder()}/${stableId}.json`);
    try {
      if (!(await this.app.vault.adapter.exists(filePath))) return null;
      const raw = await this.app.vault.adapter.read(filePath);
      const parsed = JSON.parse(raw) as CommentSidecar;
      if (parsed.version !== 1) {
        logWarn("CommentPersistenceManager: unknown sidecar version", parsed.version);
        return null;
      }
      return parsed;
    } catch (error) {
      logError("CommentPersistenceManager: load failed", filePath, error);
      return null;
    }
  }

  async renameSidecar(oldNotePath: string, newNotePath: string): Promise<void> {
    const stableId = this.index.get(oldNotePath);
    if (!stableId) return;
    this.index.delete(oldNotePath);
    this.index.set(newNotePath, stableId);
    this.scheduleIndexWrite();

    const sidecar = await this.loadSidecar(stableId);
    if (!sidecar) return;
    sidecar.notePath = newNotePath;
    sidecar.updatedAt = Date.now();
    await this.writeSidecarNow(sidecar);
  }

  async archiveSidecarForNote(notePath: string): Promise<void> {
    const stableId = this.index.get(notePath);
    if (!stableId) return;
    this.index.delete(notePath);
    this.scheduleIndexWrite();
    const folder = this.getFolder();
    const source = normalizePath(`${folder}/${stableId}.json`);
    const archiveFolder = normalizePath(`${folder}/${ARCHIVE_DIR}`);
    const target = normalizePath(`${archiveFolder}/${stableId}.json`);
    try {
      if (!(await this.app.vault.adapter.exists(source))) return;
      await ensureFolderExists(archiveFolder);
      // Copy + remove rather than rename because vault.adapter may not support rename across dirs.
      const body = await this.app.vault.adapter.read(source);
      await this.app.vault.adapter.write(target, body);
      await this.app.vault.adapter.remove(source);
    } catch (error) {
      logError("CommentPersistenceManager: archive failed", source, error);
    }
  }

  /** Build a sidecar from the in-memory comment list. */
  buildSidecar(stableId: string, notePath: string, comments: Comment[]): CommentSidecar {
    const now = Date.now();
    const firstCreatedAt = comments[0]?.createdAt ?? now;
    return {
      version: 1,
      stableId,
      notePath,
      createdAt: firstCreatedAt,
      updatedAt: now,
      comments,
    };
  }

  /** Returns true if the given sidecar-file mtime looks like a foreign edit. */
  isForeignModification(filePath: string, currentMtime: number): boolean {
    const lastWrite = this.lastWriteMtime.get(normalizePath(filePath));
    if (lastWrite === undefined) return true;
    return currentMtime - lastWrite > 1500; // tolerate small clock skew
  }

  getAllNotePaths(): string[] {
    return Array.from(this.index.keys());
  }

  // -- Internals -------------------------------------------------------------

  private async loadIndex(): Promise<void> {
    const path = normalizePath(`${this.getFolder()}/${INDEX_FILE}`);
    try {
      if (!(await this.app.vault.adapter.exists(path))) {
        await this.rebuildIndexFromSidecars();
        return;
      }
      const raw = await this.app.vault.adapter.read(path);
      const parsed = JSON.parse(raw) as IndexRecord;
      if (parsed.version !== 1 || !parsed.entries) {
        await this.rebuildIndexFromSidecars();
        return;
      }
      this.index = new Map(Object.entries(parsed.entries));
    } catch (error) {
      logWarn("CommentPersistenceManager: loadIndex failed, rebuilding", error);
      await this.rebuildIndexFromSidecars();
    }
  }

  private async rebuildIndexFromSidecars(): Promise<void> {
    this.index.clear();
    const folder = this.getFolder();
    try {
      if (!(await this.app.vault.adapter.exists(folder))) return;
      const listing = await this.app.vault.adapter.list(folder);
      for (const file of listing.files) {
        if (!file.endsWith(".json")) continue;
        if (file.endsWith(`/${INDEX_FILE}`)) continue;
        try {
          const raw = await this.app.vault.adapter.read(file);
          const parsed = JSON.parse(raw) as CommentSidecar;
          if (parsed.version !== 1 || !parsed.notePath || !parsed.stableId) continue;
          this.index.set(parsed.notePath, parsed.stableId);
        } catch {
          // ignore corrupt sidecar
        }
      }
      await this.writeIndexNow();
    } catch (error) {
      logWarn("CommentPersistenceManager: rebuildIndex failed", error);
    }
  }

  private scheduleIndexWrite(): void {
    if (this.indexWriteTimer !== null) clearTimeout(this.indexWriteTimer);
    this.indexWriteTimer = setTimeout(() => {
      this.indexWriteTimer = null;
      void this.writeIndexNow();
    }, WRITE_DEBOUNCE_MS);
  }

  private async writeIndexNow(): Promise<void> {
    const folder = this.getFolder();
    const path = normalizePath(`${folder}/${INDEX_FILE}`);
    try {
      await ensureFolderExists(folder);
      const record: IndexRecord = {
        version: 1,
        entries: Object.fromEntries(this.index.entries()),
      };
      await this.app.vault.adapter.write(path, JSON.stringify(record, null, 2));
      this.recordMtime(path);
    } catch (error) {
      logError("CommentPersistenceManager: writeIndex failed", error);
    }
  }

  private recordMtime(path: string): void {
    // Record approximate write time so the vault watcher can distinguish
    // our own writes from foreign edits.
    this.lastWriteMtime.set(normalizePath(path), Date.now());
  }

  private lookupCtime(notePath: string): number {
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (file instanceof TFile) return file.stat.ctime;
    return Date.now();
  }
}

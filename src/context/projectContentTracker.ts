import { logWarn } from "@/logger";
import { getCachedProjectRecords } from "@/projects/state";
import type { ProjectFileRecord } from "@/projects/type";
import {
  getMatchingPatterns,
  isInternalExcludedPath,
  isSystemExcludedPath,
  type PatternCategory,
} from "@/search/searchUtils";
import { debounce, type DebouncedFunction } from "@/utils/debounce";
import { App, EventRef, normalizePath, TAbstractFile, TFile, TFolder } from "obsidian";

const DEBOUNCE_MS = 2000;

type VaultEventKind = "create" | "modify" | "delete" | "rename" | "metadata";

interface PendingChange {
  kind: VaultEventKind;
  isFolder: boolean;
  isMarkdown: boolean;
  path: string;
  oldPath?: string;
}

export class ProjectContentTracker {
  private readonly vaultRefs: EventRef[] = [];
  private readonly metadataRefs: EventRef[] = [];
  private readonly pending: PendingChange[] = [];
  private readonly epochs = new Map<string, number>();
  private readonly listeners = new Set<(projectId: string) => void>();
  private readonly debouncedDrain: DebouncedFunction<() => void>;
  private disposed = false;

  constructor(
    private readonly app: App,
    debounceMs: number = DEBOUNCE_MS
  ) {
    this.debouncedDrain = debounce(() => this.drain(), debounceMs, { trailing: true });
    this.vaultRefs.push(this.app.vault.on("create", (file) => this.enqueue("create", file)));
    this.vaultRefs.push(this.app.vault.on("modify", (file) => this.enqueue("modify", file)));
    this.vaultRefs.push(this.app.vault.on("delete", (file) => this.enqueue("delete", file)));
    this.vaultRefs.push(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) =>
        this.enqueue("rename", file, oldPath)
      )
    );
    this.metadataRefs.push(
      this.app.metadataCache.on("changed", (file: TFile) => this.enqueue("metadata", file))
    );
  }

  getEpoch(projectId: string): number {
    return this.epochs.get(projectId) ?? 0;
  }

  bumpEpoch(projectId: string): number {
    const next = this.getEpoch(projectId) + 1;
    this.epochs.set(projectId, next);
    return next;
  }

  onContentChanged(callback: (projectId: string) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  flushNow(): void {
    this.debouncedDrain.flush();
  }

  dispose(): void {
    this.disposed = true;
    this.debouncedDrain.cancel();
    for (const ref of this.vaultRefs) this.app.vault.offref(ref);
    this.vaultRefs.length = 0;
    for (const ref of this.metadataRefs) this.app.metadataCache.offref(ref);
    this.metadataRefs.length = 0;
    this.pending.length = 0;
    this.listeners.clear();
    this.epochs.clear();
  }

  private enqueue(kind: VaultEventKind, file: TAbstractFile, oldPath?: string): void {
    if (this.disposed) return;
    this.pending.push({
      kind,
      isFolder: file instanceof TFolder,
      isMarkdown: file instanceof TFile && file.extension === "md",
      path: normalizeVaultPath(file.path),
      oldPath: oldPath ? normalizeVaultPath(oldPath) : undefined,
    });
    this.debouncedDrain();
  }

  private drain(): void {
    const changes = this.pending.splice(0);
    if (changes.length === 0) return;

    const affected = new Set<string>();
    for (const record of getCachedProjectRecords()) {
      try {
        if (changes.some((change) => changeAffectsProject(change, record))) {
          affected.add(record.project.id);
        }
      } catch (err) {
        logWarn(`[project-content] scope match failed for project ${record.project.id}`, err);
      }
    }

    for (const projectId of affected) {
      this.bumpEpoch(projectId);
      for (const listener of this.listeners) {
        try {
          listener(projectId);
        } catch (err) {
          logWarn(`[project-content] content-change listener failed for ${projectId}`, err);
        }
      }
    }
  }
}

function changeAffectsProject(change: PendingChange, record: ProjectFileRecord): boolean {
  const { inclusions, exclusions } = getMatchingPatterns({
    inclusions: record.project.contextSource?.inclusions,
    exclusions: record.project.contextSource?.exclusions,
    isProject: true,
  });
  if (!inclusions) return false;

  if (change.kind === "metadata") {
    return (
      (inclusions.propertyPatterns?.length ?? 0) > 0 &&
      change.isMarkdown &&
      isPropertyCandidatePath(change.path)
    );
  }

  const paths = change.oldPath ? [change.path, change.oldPath] : [change.path];
  const folderMembershipEvent =
    change.isFolder && (change.kind === "rename" || change.kind === "delete");

  const tagReaches =
    declaresTagPattern(inclusions, exclusions) && paths.some((p) => !isInternalExcludedPath(p));
  const propertyReaches =
    declaresPropertyPattern(inclusions, exclusions) && paths.some(isPropertyCandidatePath);
  if (tagReaches || propertyReaches) {
    const touchesMarkdown = change.isMarkdown || paths.some((p) => p.toLowerCase().endsWith(".md"));
    if (touchesMarkdown || folderMembershipEvent) return true;
  }

  if (change.isFolder) {
    if (change.kind === "create") {
      return (inclusions.folderPatterns ?? []).some((p) => normalizeVaultPath(p) === change.path);
    }
    if (!folderMembershipEvent) return false;
    if (
      (inclusions.folderPatterns ?? []).some((p) => paths.some((path) => foldersIntersect(path, p)))
    ) {
      return true;
    }
    return (
      (inclusions.notePatterns?.length ?? 0) > 0 || (inclusions.extensionPatterns?.length ?? 0) > 0
    );
  }

  return paths.some((path) => fileMatchesInclusions(path, inclusions));
}

function declaresTagPattern(
  inclusions: PatternCategory,
  exclusions: PatternCategory | null
): boolean {
  return (inclusions.tagPatterns?.length ?? 0) > 0 || (exclusions?.tagPatterns?.length ?? 0) > 0;
}

function declaresPropertyPattern(
  inclusions: PatternCategory,
  exclusions: PatternCategory | null
): boolean {
  return (
    (inclusions.propertyPatterns?.length ?? 0) > 0 ||
    (exclusions?.propertyPatterns?.length ?? 0) > 0
  );
}

function isPropertyCandidatePath(path: string): boolean {
  return !isInternalExcludedPath(path) && !isSystemExcludedPath(path);
}

function fileMatchesInclusions(path: string, inclusions: PatternCategory): boolean {
  if (isInternalExcludedPath(path)) return false;

  const lower = path.toLowerCase();
  if ((inclusions.extensionPatterns ?? []).some((p) => lower.endsWith(p.slice(1).toLowerCase()))) {
    return true;
  }
  if ((inclusions.folderPatterns ?? []).some((p) => isSameOrUnder(path, normalizeVaultPath(p)))) {
    return true;
  }
  const base = basenameWithoutExtension(path);
  return (inclusions.notePatterns ?? []).some((p) => p.slice(2, -2) === base);
}

function foldersIntersect(a: string, b: string): boolean {
  const left = normalizeVaultPath(a);
  const right = normalizeVaultPath(b);
  return isSameOrUnder(left, right) || isSameOrUnder(right, left);
}

function isSameOrUnder(path: string, ancestor: string): boolean {
  if (ancestor.length === 0) return false;
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

function basenameWithoutExtension(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.[^/.]+$/, "");
}

function normalizeVaultPath(path: string): string {
  return normalizePath(path).replace(/^\/+/, "").replace(/\/+$/, "");
}

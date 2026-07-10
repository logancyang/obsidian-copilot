import { logWarn } from "@/logger";
import { getCachedProjectRecords } from "@/projects/state";
import type { ProjectFileRecord } from "@/projects/type";
import {
  getMatchingPatterns,
  isInternalExcludedPath,
  type PatternCategory,
} from "@/search/searchUtils";
import { debounce, type DebouncedFunction } from "@/utils/debounce";
import { App, EventRef, normalizePath, TAbstractFile, TFile, TFolder } from "obsidian";

const DEBOUNCE_MS = 2000;

/**
 * An immutable snapshot of one vault event. We deliberately do NOT keep the
 * `TAbstractFile` reference: Obsidian mutates `TFile.path` in place on rename,
 * so a live reference read at drain time would report the post-rename path for
 * a queued pre-rename event. Snapshotting the strings at enqueue time keeps the
 * old/new paths correct.
 */
interface PendingChange {
  isFolder: boolean;
  isMarkdown: boolean;
  path: string;
  oldPath?: string;
}

/**
 * Watches the vault for changes to files a project's declared context sources
 * point at, and bumps a per-project "content epoch" when it sees one. This is
 * the freshness signal behind Agent Mode's project-context staleness fix: a
 * bumped epoch marks the project dirty (so a stale empty landing isn't reused)
 * and lets ongoing/resumed sessions surface a coarse "sources may have changed"
 * note.
 *
 * Deliberately COARSE (over-dirty is the safe direction for a freshness hint):
 * it never emits per-path deltas, never classifies binaries, and keeps no
 * change log — it only answers "did anything in this project's declared scope
 * change since epoch N?". Exact per-path/binary deltas are a separate feature.
 */
export class ProjectContentTracker {
  private readonly vaultRefs: EventRef[] = [];
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
    const onEvent = (file: TAbstractFile) => this.enqueue(file);
    this.vaultRefs.push(this.app.vault.on("create", onEvent));
    this.vaultRefs.push(this.app.vault.on("modify", onEvent));
    this.vaultRefs.push(this.app.vault.on("delete", onEvent));
    // Rename carries the previous path; snapshot both sides so a move out of or
    // into a project's scope is detected.
    this.vaultRefs.push(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) =>
        this.enqueue(file, oldPath)
      )
    );
  }

  /** The current content epoch for a project (0 if nothing has changed yet). */
  getEpoch(projectId: string): number {
    return this.epochs.get(projectId) ?? 0;
  }

  /** Subscribe to per-project content-change notifications; returns an unsubscribe. */
  onContentChanged(callback: (projectId: string) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Settle any queued events synchronously — used at send time so the turn sees
   * a change the user made moments before sending (the debounce would otherwise
   * still be pending). `flush()` invokes the trailing drain and clears the timer,
   * so there is no later double-fire.
   */
  flushNow(): void {
    this.debouncedDrain.flush();
  }

  dispose(): void {
    this.disposed = true;
    this.debouncedDrain.cancel();
    for (const ref of this.vaultRefs) this.app.vault.offref(ref);
    this.vaultRefs.length = 0;
    this.pending.length = 0;
    this.listeners.clear();
    this.epochs.clear();
  }

  private enqueue(file: TAbstractFile, oldPath?: string): void {
    // Guard against an event delivered after teardown (offref should prevent this,
    // but a queued microtask could still arrive) so a disposed tracker stays inert.
    if (this.disposed) return;
    this.pending.push({
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
        // A malformed pattern in one project must not stop the sweep for others,
        // nor break the watcher.
        logWarn(`[project-content] scope match failed for project ${record.project.id}`, err);
      }
    }

    for (const projectId of affected) {
      this.epochs.set(projectId, this.getEpoch(projectId) + 1);
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

/**
 * Whether a single vault change touches a project's declared context scope.
 * Conservative by design: inclusion-only matching (exclusions only ever shrink
 * the set, so ignoring them just yields an occasional harmless extra note), plus
 * a broad tag rule and broad folder rule since neither can be resolved precisely
 * from a path string alone.
 */
function changeAffectsProject(change: PendingChange, record: ProjectFileRecord): boolean {
  const { inclusions, exclusions } = getMatchingPatterns({
    inclusions: record.project.contextSource?.inclusions,
    exclusions: record.project.contextSource?.exclusions,
    isProject: true,
  });
  // A project with no inclusions materializes nothing, so nothing can dirty it.
  if (!inclusions) return false;

  // Tag membership can't be recovered from a path (and the metadata cache may
  // not have parsed a just-edited file yet), so ANY markdown change conservatively
  // dirties a project that declares a tag pattern on either side.
  if (change.isMarkdown && declaresTagPattern(inclusions, exclusions)) return true;

  const paths = change.oldPath ? [change.path, change.oldPath] : [change.path];

  if (change.isFolder) {
    // Obsidian doesn't guarantee child events on a folder op, so match the folder
    // path against folder patterns in BOTH directions (the event path may be an
    // ancestor OR a descendant of a pattern), and conservatively dirty projects
    // whose note/extension members a folder move could have relocated.
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

function fileMatchesInclusions(path: string, inclusions: PatternCategory): boolean {
  // Internal Copilot files (project.md, the AGENTS.md mirror, the log) can be
  // caught by a `*.md` or projects-folder pattern but must never count as a
  // context source — mirror shouldIndexFile's exclusion for the dead-path case.
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

/** True when either folder path is the same as, or nested under, the other. */
function foldersIntersect(a: string, b: string): boolean {
  const left = normalizeVaultPath(a);
  const right = normalizeVaultPath(b);
  return isSameOrUnder(left, right) || isSameOrUnder(right, left);
}

/** True when `path` equals `ancestor` or sits directly under it. */
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

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

/**
 * An immutable snapshot of one vault event. We deliberately do NOT keep the
 * `TAbstractFile` reference: Obsidian mutates `TFile.path` in place on rename,
 * so a live reference read at drain time would report the post-rename path for
 * a queued pre-rename event. Snapshotting the strings at enqueue time keeps the
 * old/new paths correct.
 */
type VaultEventKind = "create" | "modify" | "delete" | "rename" | "metadata";

interface PendingChange {
  kind: VaultEventKind;
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
    // Rename carries the previous path; snapshot both sides so a move out of or
    // into a project's scope is detected.
    this.vaultRefs.push(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) =>
        this.enqueue("rename", file, oldPath)
      )
    );
    // The metadata cache re-parses a note's frontmatter asynchronously, AFTER the
    // vault `modify` event. A property source resolved on `modify` would read the
    // stale cache and never re-resolve, staying permanently out of date. The
    // `changed` event fires once the cache is current, so enqueue it as a distinct
    // `metadata` kind that (see changeAffectsProject) re-dirties ONLY property-
    // inclusion projects — no other source reads the cache, so none should react.
    // Registered on the metadata cache, a different emitter than the vault, so its
    // refs are tracked and torn down separately (metadataCache.offref).
    this.metadataRefs.push(
      this.app.metadataCache.on("changed", (file: TFile) => this.enqueue("metadata", file))
    );
  }

  /** The current content epoch for a project (0 if nothing has changed yet). */
  getEpoch(projectId: string): number {
    return this.epochs.get(projectId) ?? 0;
  }

  /**
   * Advance a project's content epoch by one and return the new value. Used both
   * internally (a matched vault change) and by the session manager for a config
   * source edit, so a config change and a content change advance the SAME epoch —
   * an ongoing session then gets the coarse note in either case.
   */
  bumpEpoch(projectId: string): number {
    const next = this.getEpoch(projectId) + 1;
    this.epochs.set(projectId, next);
    return next;
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
    for (const ref of this.metadataRefs) this.app.metadataCache.offref(ref);
    this.metadataRefs.length = 0;
    this.pending.length = 0;
    this.listeners.clear();
    this.epochs.clear();
  }

  private enqueue(kind: VaultEventKind, file: TAbstractFile, oldPath?: string): void {
    // Guard against an event delivered after teardown (offref should prevent this,
    // but a queued microtask could still arrive) so a disposed tracker stays inert.
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
        // A malformed pattern in one project must not stop the sweep for others,
        // nor break the watcher.
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

  // A `metadata` event means the cache finished re-parsing a note's frontmatter —
  // the moment a property source can resolve against fresh data. It matters ONLY to
  // projects that ENUMERATE notes from frontmatter, i.e. that declare a property
  // INCLUSION (resolvePropertyNotePaths). Tags carry a static label and never read
  // the cache; folder/note/extension match by path; a bare property exclusion never
  // enumerates. So this event dirties a project iff it declares a property inclusion
  // and the changed file is a real markdown note that property enumeration can reach
  // — every other source is left untouched, avoiding needless invalidation and
  // startup-index churn.
  if (change.kind === "metadata") {
    return (
      (inclusions.propertyPatterns?.length ?? 0) > 0 &&
      change.isMarkdown &&
      isPropertyCandidatePath(change.path)
    );
  }

  const paths = change.oldPath ? [change.path, change.oldPath] : [change.path];
  // Only a folder RENAME or DELETE can change which files exist under a scope; a
  // folder CREATE is an empty directory with no members, so it can't dirty anything.
  const folderMembershipEvent =
    change.isFolder && (change.kind === "rename" || change.kind === "delete");

  // A tag's membership and a property's value both live in a note's frontmatter/
  // metadata and can't be recovered from a path (the metadata cache may also not
  // have re-parsed a just-edited file yet), so conservatively dirty a project that
  // declares EITHER on any event that could change which files carry a tag or hold
  // a property value: a markdown change (checked on BOTH rename sides — a
  // `.md → .txt` rename leaves frontmatter scope) or a folder rename/delete that
  // could move such notes. Each source uses its own reachability rule: a tag only
  // skips internal Copilot files, while a property additionally skips the system
  // Copilot roots its enumeration can never return (see isPropertyCandidatePath).
  // Keep the event when ANY side is reachable — an internal ↔ user rename counts.
  const tagReaches =
    declaresTagPattern(inclusions, exclusions) && paths.some((p) => !isInternalExcludedPath(p));
  const propertyReaches =
    declaresPropertyPattern(inclusions, exclusions) && paths.some(isPropertyCandidatePath);
  if (tagReaches || propertyReaches) {
    const touchesMarkdown = change.isMarkdown || paths.some((p) => p.toLowerCase().endsWith(".md"));
    if (touchesMarkdown || folderMembershipEvent) return true;
  }

  if (change.isFolder) {
    // A folder CREATE matters ONLY when the created folder IS an exactly-declared
    // folder pattern: `resolveFolderPaths` (projectContextMaterializer) then turns
    // that previously-unresolved source into a real manifest entry (absPath) and,
    // when it's out-of-cwd, a mounted `additionalDirectories` search root — so a
    // stale empty landing must not be reused. A parent/child create resolves no
    // DIFFERENT pattern (an unrelated declared subfolder stays unresolved; an
    // already-existing declared root is unaffected) and changes no tag/note/
    // extension membership, so the broad fallbacks stay OFF for CREATE.
    if (change.kind === "create") {
      return (inclusions.folderPatterns ?? []).some((p) => normalizeVaultPath(p) === change.path);
    }
    // A folder MODIFY changes nothing; only RENAME/DELETE move existing members.
    if (!folderMembershipEvent) return false;
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

/**
 * Whether a project declares a tag source. Tag membership lives in a note's
 * frontmatter/metadata and can't be resolved from a path alone, so a project
 * declaring one must be dirtied conservatively on any metadata-bearing change.
 * Checks exclusions too: a tag EXCLUSION also shifts the materialized set when a
 * note's frontmatter changes.
 */
function declaresTagPattern(
  inclusions: PatternCategory,
  exclusions: PatternCategory | null
): boolean {
  return (inclusions.tagPatterns?.length ?? 0) > 0 || (exclusions?.tagPatterns?.length ?? 0) > 0;
}

/**
 * Whether a project declares a property source, the property counterpart of
 * {@link declaresTagPattern}. Kept separate from the tag check because the two
 * reach different files: property enumeration runs through `shouldIndexFile`, so
 * it can never return a note under a system Copilot root, while tags keep their
 * pre-existing broader rule.
 */
function declaresPropertyPattern(
  inclusions: PatternCategory,
  exclusions: PatternCategory | null
): boolean {
  return (
    (inclusions.propertyPatterns?.length ?? 0) > 0 ||
    (exclusions?.propertyPatterns?.length ?? 0) > 0
  );
}

/**
 * Whether a path is one that property enumeration could ever return. Mirrors the
 * `shouldIndexFile` exclusions `resolvePropertyNotePaths` runs through: internal
 * Copilot files and the system Copilot roots (active and historical) are always
 * dropped there, so a change to one cannot alter a property source's note set.
 * Without the system-root half, Copilot's own chat autosave — on by default, and
 * frontmatter-bearing — would dirty every property project every few seconds.
 */
function isPropertyCandidatePath(path: string): boolean {
  return !isInternalExcludedPath(path) && !isSystemExcludedPath(path);
}

function fileMatchesInclusions(path: string, inclusions: PatternCategory): boolean {
  // DESIGN NOTE — no `propertyPatterns` branch here, deliberately.
  //
  // Every markdown event on a path property enumeration can reach has already
  // returned through the `propertyReaches` gate above. A markdown event that
  // still arrives here is under an internal/system root, which that enumeration
  // can never return. The only other case is a non-markdown path, and
  // `resolvePropertyNotePaths` enumerates `vault.getMarkdownFiles()` only — so
  // creating or deleting a `.pdf` cannot change a property source's note set.
  // A branch here would be dead code guarding a state that cannot occur.
  // If a future review flags the missing property case again, point them here.
  //
  // Internal Copilot files (project.md, AGENTS.md, CLAUDE.md, the log) can be
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

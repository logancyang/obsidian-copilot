import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { err2String } from "@/errorFormat";
import { logInfo, logWarn } from "@/logger";
import { getCachedProjectRecordById } from "@/projects/state";
import { getProjectContextSignature } from "@/projects/projectContextSignature";
import { getMatchingPatterns } from "@/search/searchUtils";
import { listMaterializeCandidates } from "@/context/materializeCandidates";
import { Mutex } from "async-mutex";
import { App, FileSystemAdapter, TFile, TFolder } from "obsidian";
import { createNodeContextCacheFs } from "./contextCacheFs";
import {
  cacheRoot,
  filesDir,
  markersDir,
  remotesDir,
  snapshotAbsPath,
} from "./conversionsLocation";
import {
  materializeSources,
  reconcileMarkers,
  type ContextConverters,
  type FileSource,
  type MaterializedSourceType,
  type MaterializeSourceIdentity,
  type RemoteSource,
  type SourceFailure,
} from "./contextCacheStore";
import { buildProjectContextBlock, type ManifestPathEntry } from "./manifestBuilder";

/**
 * Plain-data result of materializing a project's context before a session opens.
 *
 * This is the shared contract resolved by a session's `contextReady`. Keep it
 * minimal: searchable roots plus the optional inline context block — nothing
 * else. Reason: progress counts for the UI loading card live in a SEPARATE
 * `agentProjectContextLoadAtom`, never here, so this stays a clean dirs+block
 * value that any backend / the UI can consume without folding in load state.
 */
export interface ContextMaterializationResult {
  /** Absolute paths to widen the agent's searchable roots (add-dir). Empty if none. */
  additionalDirectories: string[];
  /**
   * The `<project_context>` block to inline into the session's FIRST user
   * prompt (absolute folder/note paths, snapshot pointers, tag/ext/URL guides).
   * Undefined when the project declares no context sources.
   */
  projectContextBlock?: string;
  /**
   * The context signature of the project record THIS run actually read (see
   * {@link getProjectContextSignature}). Lets a caller tell which source revision
   * was captured — critical because the single-flight guard can hand a joined
   * caller a result materialized from an EARLIER record than the one live now.
   * Undefined only when no record was found, or the whole run threw.
   */
  contextSignature?: string;
}

/**
 * Live progress for the materialization steps, surfaced to the UI loading card.
 * Carried OUT-OF-BAND from {@link ContextMaterializationResult} (counts never
 * fold into the result) so the result stays a clean dirs+block value. The
 * session manager is the sole subscriber and republishes these to the
 * projectId-keyed `agentProjectContextLoadAtom`.
 */
export type ContextMaterializeProgress =
  | { phase: "resolve"; resolved: number }
  | { phase: "prefetch"; done: number; total: number }
  | { phase: "parse"; done: number; total: number }
  | { phase: "itemStart"; item: MaterializeSourceIdentity }
  | { phase: "itemFailed"; item: MaterializeSourceIdentity; failure: SourceFailure }
  | { phase: "itemSettled"; item: MaterializeSourceIdentity }
  | { phase: "failures"; failures: SourceFailure[] };

export type ContextMaterializeProgressFn = (progress: ContextMaterializeProgress) => void;

// Referential stability: a single frozen empty array for every "no context" exit.
const EMPTY_DIRECTORIES: string[] = Object.freeze([] as string[]) as string[];
/**
 * Frozen fallback result for the "no usable record / whole-run failure" exits —
 * NO `contextSignature`, so it never clears a caller's dirty flag (nothing was
 * captured). A project that resolves to no sources returns a DISTINCT result
 * carrying its signature (so its dirty flag can clear); only the record-absent
 * and catch paths use this shared frozen reference. Exported so the session
 * manager's materialize-failure path hands back the same reference.
 */
export const EMPTY_CONTEXT_MATERIALIZATION_RESULT: ContextMaterializationResult = Object.freeze({
  additionalDirectories: EMPTY_DIRECTORIES,
});
const EMPTY_RESULT = EMPTY_CONTEXT_MATERIALIZATION_RESULT;

/**
 * Per-project single-flight guard. Concurrent cold-start sessions for the same
 * project (e.g. the user opens a second chat / a history-load races the first)
 * would otherwise each miss the disk cheap-skip before the first write lands and
 * redundantly hit brevilabs + race on the same hash-named cache files. The map
 * entry is cleared once the promise settles, so a later call re-evaluates fresh
 * on-disk fingerprints (idempotent). Mirrors `inFlightMigrations`.
 *
 * DESIGN NOTE — keyed by `projectId` ALONE, not `projectId+cwd`. `cwd` is a pure
 * function of `projectId` (`resolveScopeCwd` → `dirname(record.filePath)`), so
 * two concurrent calls for the same project resolve the same cwd. They could
 * diverge only if the project folder is renamed in the sub-second window between
 * two cold-start session opens while a materialize is mid-flight — at which point
 * the joined caller would write to the pre-rename dir. That window is effectively
 * unreachable, the next session (in-flight entry cleared on settle) self-heals to
 * the new cwd, and keying by cwd would weaken the single-flight (the whole point
 * is to dedupe per project). Not worth the extra key.
 *
 * The entry carries whether its run is a FORCED retry so the single-flight can
 * tell a background warm apart from a user "Retry": a forced call supersedes an
 * in-flight non-force run (see {@link ensureProjectContextMaterialized}). It also
 * carries the context signature the run is materializing, so a caller wanting a
 * NEWER source set (the project's context was edited mid-flight) supersedes the
 * stale run instead of joining it.
 */
interface InFlightMaterialization {
  promise: Promise<ContextMaterializationResult>;
  /** True when this run bypasses failure markers (a user-initiated retry). */
  forceRetryFailed: boolean;
  /**
   * Context signature ({@link getProjectContextSignature}) of the project record
   * this run is materializing, captured when the run was queued. A later caller
   * whose record signature differs supersedes rather than joins — otherwise it
   * would receive the pre-edit `<project_context>` / `additionalDirectories`.
   * `undefined` when no record was cached at queue time.
   */
  contextSignature: string | undefined;
}

const inFlightMaterializations = new Map<string, InFlightMaterialization>();

/**
 * Global per-artifact locks keyed by snapshot file name. Because the file name is
 * derived from the source IDENTITY (never the project), the SAME source across
 * two projects maps to the SAME mutex — so two projects cold-converting one URL
 * converge to a single fetch: the first acquires the lock, reads meta (miss),
 * fetches, atomically writes, releases; the second waits, acquires, re-reads the
 * now-present meta, and cheap-skips without re-fetching or overwriting. Mirrors
 * CAG's `ProjectContextCache.getOrCreateProjectMutex`.
 *
 * The map is bounded by the count of distinct cached sources in a vault (small),
 * so it is never pruned — matching CAG, which likewise retains its mutexes.
 */
const sourceArtifactMutexes = new Map<string, Mutex>();

/**
 * Get-or-create the mutex for a snapshot file name. No creation lock is needed
 * (unlike CAG's belt-and-suspenders `mutexCreationMutex`): there is no `await`
 * between the `get` and the `set`, so in JS's single-threaded model two
 * concurrent callers run this synchronously to completion and observe the same
 * instance. # Reason: a creation mutex would only matter if creation could yield.
 */
function getSourceArtifactMutex(key: string): Mutex {
  let mutex = sourceArtifactMutexes.get(key);
  if (!mutex) {
    mutex = new Mutex();
    sourceArtifactMutexes.set(key, mutex);
  }
  return mutex;
}

/** Run a source's read-decide-write under its global per-artifact lock. */
function withSourceLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  return getSourceArtifactMutex(key).runExclusive(run);
}

/**
 * Cache-root-RELATIVE form of a conversionsLocation absolute directory, for the
 * root-confined node fs (which rejects absolute paths). conversionsLocation
 * builds every directory under `root`, so the relative part is the suffix after
 * the root prefix; normalized to POSIX so the node fs resolves it identically on
 * every OS. Fails loud if the path is not actually under root (it always is —
 * this guards a future layout drift rather than a live case).
 */
function cacheRootRelativeDir(root: string, absoluteDir: string): string {
  const normRoot = toPosix(root).replace(/\/+$/, "");
  const normDir = toPosix(absoluteDir).replace(/\/+$/, "");
  if (normDir === normRoot) return "";
  const prefix = `${normRoot}/`;
  if (!normDir.startsWith(prefix)) {
    throw new Error(`context-cache directory escapes root: ${absoluteDir}`);
  }
  return normDir.slice(prefix.length);
}

/** Normalize OS-native separators to POSIX for the root-confined node fs. */
function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Materialize a project's external context (URLs/YouTube/PDFs/images) into the
 * vault's shared off-vault conversion cache, build a source manifest, and report
 * any out-of-cwd folder inclusions as extra searchable roots. Called by the
 * session manager at its cwd choke points, after config migration + cwd
 * resolution.
 *
 * Contract (relied on by the manager): NEVER rejects — any failure degrades to a
 * best-effort partial / empty result so session start is never blocked. Cheap on
 * unchanged context (successful snapshots cheap-skip by fingerprint, known-bad
 * sources cheap-skip by failure marker). Concurrent calls for the same project
 * dedupe to one in-flight run; concurrent runs across projects converging on one
 * shared source dedupe to a single fetch via the per-artifact lock.
 * `forceRetryFailed` (the status popover's "Retry") re-attempts known-bad sources
 * instead of honoring their markers. Writes only under the off-vault cache root.
 */
export async function ensureProjectContextMaterialized(
  app: App,
  projectId: string,
  cwd: string,
  onProgress?: ContextMaterializeProgressFn,
  forceRetryFailed?: boolean
): Promise<ContextMaterializationResult> {
  const force = forceRetryFailed ?? false;
  // Captured synchronously so an incoming caller can tell whether the in-flight
  // run is materializing the source revision it actually wants.
  const record = getCachedProjectRecordById(projectId);
  const currentSignature = record ? getProjectContextSignature(record) : undefined;
  const existing = inFlightMaterializations.get(projectId);
  // Single-flight: a second concurrent caller joins the in-flight run and its
  // `onProgress` is intentionally dropped — the flight owner's sink already
  // drives the shared progress atom, so every reader still sees live counts.
  //
  // A caller joins ONLY when the in-flight run is materializing the SAME source
  // set it wants (matching signature). If the project's context was edited while
  // a run is in flight, that run's signature is now stale — joining it would hand
  // the caller the pre-edit `<project_context>` / `additionalDirectories` (and the
  // queued first send would flush with the old sources), so it SUPERSEDES below
  // to capture the new sources instead.
  //
  // Among same-signature runs: a non-force caller joins; a forced retry joins only
  // an already-forced run. A forced retry that finds a NON-force run in flight
  // (e.g. a background warm, invisible to the manager's early-exit check) must NOT
  // join it — that would cheap-skip the known-bad sources the user explicitly
  // asked to re-fetch. Instead it SUPERSEDES below.
  if (
    existing &&
    existing.contextSignature === currentSignature &&
    (!force || existing.forceRetryFailed)
  ) {
    return existing.promise;
  }

  // Take over the slot SYNCHRONOUSLY so a concurrent session-create joins this
  // forced run rather than the run it replaces — but defer the forced run's own
  // disk work until the prior run settles, so the two never race-write the same
  // hash-named cache files (the prior keeps the never-reject contract, so its
  // rejection can't happen, but guard defensively).
  const prior = existing?.promise;
  const promise = (async () => {
    if (prior) await prior.catch(() => undefined);
    return runMaterialize(app, projectId, cwd, onProgress, force);
  })().finally(() => {
    // Guarded clear: a superseded prior run's own `finally` may fire after we've
    // claimed the slot, so only delete when it still points at THIS promise.
    if (inFlightMaterializations.get(projectId)?.promise === promise) {
      inFlightMaterializations.delete(projectId);
    }
  });
  inFlightMaterializations.set(projectId, {
    promise,
    forceRetryFailed: force,
    contextSignature: currentSignature,
  });
  return promise;
}

/**
 * The materialization body, wrapped so it always resolves with a result —
 * `ensureProjectContextMaterialized` adds the single-flight guard on top.
 */
async function runMaterialize(
  app: App,
  projectId: string,
  cwd: string,
  onProgress?: ContextMaterializeProgressFn,
  forceRetryFailed?: boolean
): Promise<ContextMaterializationResult> {
  try {
    const record = getCachedProjectRecordById(projectId);
    if (!record) return EMPTY_RESULT;
    // Captured up front from the record THIS run reads, so the result reports the
    // exact source revision it materialized (the dirty-tracking caller relies on
    // this to avoid clearing a flag a newer edit raised — see the result field).
    const contextSignature = getProjectContextSignature(record);
    const contextSource = record.project.contextSource;
    if (!contextSource) return { additionalDirectories: EMPTY_DIRECTORIES, contextSignature };

    const webUrls = splitLines(contextSource.webUrls);
    const youtubeUrls = splitLines(contextSource.youtubeUrls);
    const remotes: RemoteSource[] = [
      ...webUrls.map((url): RemoteSource => ({ type: "web", url })),
      ...youtubeUrls.map((url): RemoteSource => ({ type: "youtube", url })),
    ];

    // DESIGN NOTE — exclusions are parsed (they gate `listMaterializeCandidates`
    // below, so excluded binaries aren't converted) but deliberately NOT carried
    // into the manifest/search guidance. PR2 exclusion is Tier 1 (soft,
    // best-effort = "don't materialize / don't feed" + ignore files); it does NOT
    // stop the agent's native grep from reading an excluded file inside an
    // included folder. That "粒度错配的洞" is explicitly acknowledged-and-unblocked
    // — hard enforcement needs a backend/OS sandbox (Tier 2/3), deferred past PR2.
    // See designdocs/agent-projects/PR2_DESIGN.md §4.1.1.
    const { inclusions } = getMatchingPatterns({
      inclusions: contextSource.inclusions,
      exclusions: contextSource.exclusions,
      isProject: true,
    });
    const folders = inclusions?.folderPatterns ?? [];
    const notes = inclusions?.notePatterns ?? [];
    // DESIGN NOTE — tag/extension inclusions are forwarded to the manifest as
    // SOURCE LABELS, not resolved to absolute paths or `additionalDirectories`
    // (unlike folders/notes, which are concrete locations). PR2 routes tags/
    // extensions through the agent's NATIVE search (grep/find + a resident
    // instruction on counting Obsidian tags); precise/efficient resolution
    // (MCP `tag_search`) is deferred to PR3. So a tag whose matches live outside
    // the project cwd is reachable only via that native search, by design.
    // See designdocs/agent-projects/PR2_DESIGN.md §4.1.
    const extensions = inclusions?.extensionPatterns ?? [];
    const tags = inclusions?.tagPatterns ?? [];

    const adapter = getVaultFileSystemAdapter(app);
    const { entries: folderEntries, additionalDirectories } = resolveFolderPaths(
      app,
      folders,
      cwd,
      adapter
    );
    const noteEntries = resolveNotePaths(app, notes, adapter);

    const files: FileSource[] = inclusions
      ? listMaterializeCandidates(app, contextSource).map((file) => ({
          vaultPath: file.path,
          ext: file.extension.toLowerCase(),
          mtime: file.stat.mtime,
          size: file.stat.size,
          read: () => app.vault.readBinary(file),
        }))
      : [];

    const hasAnySource =
      remotes.length > 0 ||
      files.length > 0 ||
      folders.length > 0 ||
      notes.length > 0 ||
      extensions.length > 0 ||
      tags.length > 0 ||
      additionalDirectories.length > 0;
    if (!hasAnySource) return { additionalDirectories: EMPTY_DIRECTORIES, contextSignature };

    // Inclusions are resolved; report the count of binary files queued for
    // materialization so the loading card can show "Resolve files (N)".
    onProgress?.({ phase: "resolve", resolved: files.length });

    // The cache is OFF-VAULT and SHARED across projects: remote/file snapshots
    // are keyed by source identity (one copy per vault), only failure markers are
    // per-project. The node fs is root-confined at `cacheRoot`, so the store gets
    // cache-root-relative dirs (it rejects absolute paths). These node builtins
    // run desktop-only — the materializer is reachable solely through the dynamic
    // Agent Mode chunk (see main.ts desktop gate).
    const root = cacheRoot(app);
    const fs = createNodeContextCacheFs(root);
    const remotesRel = cacheRootRelativeDir(root, remotesDir(app));
    const filesRel = cacheRootRelativeDir(root, filesDir(app));
    const markersRel = cacheRootRelativeDir(root, markersDir(app, projectId));

    const { entries, wantedMarkerNames, failures } = await materializeSources({
      remotesDir: remotesRel,
      filesDir: filesRel,
      markerDir: markersRel,
      fs,
      converters: createConverters(),
      remotes,
      files,
      nowMs: Date.now(),
      forceRetryFailed,
      onProgress,
      withSourceLock,
    });

    // Surface per-source failures out-of-band (never folded into the result, which
    // stays a clean dirs+block value). Always emitted — an empty array clears any
    // prior run's failures in the subscriber.
    onProgress?.({ phase: "failures", failures });

    // Resolve each present snapshot to its absolute, off-vault path so the
    // manifest can point the agent straight at it (the shared cache lives outside
    // every project cwd; an absolute path is the only pointer all three backends
    // can reach). conversionsLocation owns the layout, so the type→bucket mapping
    // is not duplicated here. Desktop-only, like the rest of this function.
    const manifestEntries = entries.map((entry) => ({
      ...entry,
      snapshotAbsPath: snapshotAbsPath(app, entry.type, entry.cacheFileName),
    }));

    const projectContextBlock = buildProjectContextBlock({
      folders: folderEntries,
      notes: noteEntries,
      extensions,
      tags,
      webUrls,
      youtubeUrls,
      materialized: manifestEntries,
    });
    // No manifest file is written: the block above is inlined into the session's
    // first user prompt. Only the per-project failure markers are reconciled —
    // shared snapshots are never pruned against one project's sources (that would
    // delete files other projects still reference).
    await reconcileMarkers(fs, markersRel, wantedMarkerNames);

    logInfo(
      `[project-context] materialized ${entries.length} source(s) for ${projectId}; ` +
        `add-dir=${additionalDirectories.length}, failures=${failures.length}`
    );

    return {
      additionalDirectories:
        additionalDirectories.length > 0 ? additionalDirectories : EMPTY_DIRECTORIES,
      projectContextBlock,
      contextSignature,
    };
  } catch (err) {
    // A failure HERE (not a per-source fetch/parse error, which never throws) is a
    // whole-materialization breakdown: cache fs, reconcile, or block builder. Keep
    // the never-reject contract, but surface it as a single synthetic failure so
    // the status icon can still flag "context unavailable" with a readable cause.
    const error = err2String(err);
    logWarn(`[project-context] materialize failed for ${projectId}; continuing`, err);
    onProgress?.({
      phase: "failures",
      failures: [{ source: "Project context", kind: "file", error, usedStaleSnapshot: false }],
    });
    return EMPTY_RESULT;
  }
}

/** Brevilabs-backed converters. Empty results throw so no useless cache file is written. */
function createConverters(): ContextConverters {
  return {
    fetchRemote: async (source) => {
      const client = BrevilabsClient.getInstance();
      const content =
        source.type === "youtube"
          ? ((await client.youtube4llm(source.url)).response?.transcript ?? "")
          : ((await client.url4llm(source.url)).response ?? "");
      if (!content.trim()) throw new Error(`empty content for ${source.url}`);
      return content;
    },
    parseFile: async (bytes, ext) => {
      const { response } = await BrevilabsClient.getInstance().docs4llm(bytes, ext);
      const content = docs4llmToText(response);
      if (!content.trim()) throw new Error(`empty parse result for .${ext}`);
      return content;
    },
  };
}

/**
 * Re-materialize a SINGLE context source — the per-row "Retry" in the Content
 * Conversion panel. Reuses the same off-vault cache dirs / converters as the full
 * run but skips reconcile: it only (re)writes this one source's snapshot or
 * failure marker (materializeSources clears the marker on success), leaving every
 * other source untouched. Forces a retry past the failure marker (this IS the
 * user's explicit retry). The per-artifact lock makes this safe against a
 * concurrent full run on the same source — they serialize on the snapshot key, so
 * neither overwrites the other and shared snapshots (never reconciled) can't be
 * reaped. Returns this source's failures (empty on success). Never throws,
 * mirroring the full run's contract.
 */
export async function materializeProjectContextSource(
  app: App,
  projectId: string,
  item: { kind: MaterializedSourceType; source: string }
): Promise<SourceFailure[]> {
  const record = getCachedProjectRecordById(projectId);
  if (!record) {
    return [
      {
        source: item.source,
        kind: item.kind,
        error: "Project not found",
        usedStaleSnapshot: false,
      },
    ];
  }

  let remotes: RemoteSource[] = [];
  let files: FileSource[] = [];
  if (item.kind === "file") {
    const file = app.vault.getAbstractFileByPath(item.source);
    if (!(file instanceof TFile)) {
      return [
        {
          source: item.source,
          kind: "file",
          error: "File not found in vault",
          usedStaleSnapshot: false,
        },
      ];
    }
    files = [
      {
        vaultPath: file.path,
        ext: file.extension.toLowerCase(),
        mtime: file.stat.mtime,
        size: file.stat.size,
        read: () => app.vault.readBinary(file),
      },
    ];
  } else {
    remotes = [{ type: item.kind, url: item.source }];
  }

  try {
    const root = cacheRoot(app);
    const fs = createNodeContextCacheFs(root);
    const { failures } = await materializeSources({
      remotesDir: cacheRootRelativeDir(root, remotesDir(app)),
      filesDir: cacheRootRelativeDir(root, filesDir(app)),
      markerDir: cacheRootRelativeDir(root, markersDir(app, projectId)),
      fs,
      converters: createConverters(),
      remotes,
      files,
      nowMs: Date.now(),
      forceRetryFailed: true,
      withSourceLock,
    });
    return failures;
  } catch (err) {
    return [
      { source: item.source, kind: item.kind, error: err2String(err), usedStaleSnapshot: false },
    ];
  }
}

/** docs4llm's `response` is `unknown` — normalize to text for the cache file. */
function docs4llmToText(response: unknown): string {
  if (typeof response === "string") return response;
  try {
    return JSON.stringify(response, null, 2);
  } catch (err) {
    logWarn(`[project-context] could not stringify docs4llm response: ${err2String(err)}`);
    return "";
  }
}

/**
 * The desktop disk-backed adapter, or null otherwise. Used to turn vault paths
 * into absolute OS paths (`getFullPath`) for the agent backend's searchable
 * roots; a non-disk adapter (mobile / in-memory) degrades to vault-path-only
 * manifest entries with no add-dir.
 */
function getVaultFileSystemAdapter(app: App): FileSystemAdapter | null {
  const adapter = app.vault.adapter;
  return adapter instanceof FileSystemAdapter ? adapter : null;
}

/**
 * Resolve folder inclusions to absolute `ManifestPathEntry`s for the context
 * block, and collect the subset that lives OUTSIDE the project cwd as add-dir
 * roots. In-cwd folders need no add-dir (already searchable); a pattern that
 * doesn't resolve to a real folder (e.g. a glob) is still listed in the block by
 * its vault path, just without an absolute path / add-dir entry.
 */
function resolveFolderPaths(
  app: App,
  folderPatterns: string[],
  cwd: string,
  adapter: FileSystemAdapter | null
): { entries: ManifestPathEntry[]; additionalDirectories: string[] } {
  const entries: ManifestPathEntry[] = [];
  const external = new Set<string>();
  for (const pattern of folderPatterns) {
    const vaultPath = pattern.replace(/\/+$/, "");
    const folder = app.vault.getAbstractFileByPath(vaultPath);
    if (adapter && folder instanceof TFolder) {
      const abs = adapter.getFullPath(folder.path);
      entries.push({ vaultPath, absPath: abs });
      if (!isUnderCwd(cwd, abs)) external.add(abs);
    } else {
      entries.push({ vaultPath });
    }
  }
  return {
    entries,
    additionalDirectories: external.size > 0 ? [...external] : EMPTY_DIRECTORIES,
  };
}

/**
 * Resolve `[[Title]]` note inclusions to absolute `ManifestPathEntry`s. The
 * title is matched against file basenames, mirroring how `searchUtils`'
 * `matchFilePathWithNotes` pairs a note pattern to a vault file — so a title
 * shared by several notes lists EVERY match (matching the inclusion semantics),
 * not just the first. A pattern with no matching file is still listed by its raw
 * `[[Title]]` form so the source is never dropped.
 *
 * DESIGN NOTE — notes deliberately do NOT contribute to `additionalDirectories`
 * (folders do; see {@link resolveFolderPaths}). Trigger: a note included from
 * OUTSIDE the project cwd. Assessment: NOT a defect (P-low, no live trigger).
 * Under the soft-scope model the note's absolute path listed in the
 * `<project_context>` block is readable on all three backends today via
 * explicit-path read (verified — `designdocs/agent-projects/verify/ADDDIR_FINDINGS.md`).
 * add-dir is a claude-only autonomous-search enhancement codex/opencode ignore;
 * granting one note's whole parent folder would over-grant — the exact thing
 * `obsidian-copilot-preview#165` aims to curb.
 */
function resolveNotePaths(
  app: App,
  notePatterns: string[],
  adapter: FileSystemAdapter | null
): ManifestPathEntry[] {
  if (notePatterns.length === 0) return [];
  const files = adapter ? app.vault.getFiles() : [];
  return notePatterns.flatMap((pattern) => {
    // categorizePatterns guarantees the `[[ ... ]]` shape, so slicing is safe.
    const title = pattern.slice(2, -2);
    if (!adapter) return [{ vaultPath: pattern }];
    const matches = files.filter((file) => file.basename === title);
    if (matches.length === 0) return [{ vaultPath: pattern }];
    return matches.map((file) => ({
      vaultPath: file.path,
      absPath: adapter.getFullPath(file.path),
    }));
  });
}

/**
 * Whether an absolute path lives at or under the session cwd. Compared on
 * forward-slash-normalized strings (not `node:path`) so it holds regardless of
 * the OS separator `getFullPath`/cwd report — folders already inside the cwd
 * need no add-dir root; only the rest become searchable-root entries.
 */
function isUnderCwd(cwd: string, abs: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = norm(cwd);
  const target = norm(abs);
  return target === base || target.startsWith(`${base}/`);
}

/** Split a newline-joined config string into trimmed, non-empty entries. */
function splitLines(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

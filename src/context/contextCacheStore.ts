import { err2String } from "@/errorFormat";
import { logWarn } from "@/logger";
import { md5 } from "@/utils/hash";
import type { UrlKind } from "@/utils/urlTagUtils";
import type { ContextCacheFs } from "./contextCacheFs";

/** Source kinds that get materialized into the conversion cache as text
 * snapshots. The single source of truth — file-name patterns (see
 * {@link OWNED_MARKER_RE}) and other modules' source-kind unions derive from
 * this, so adding a kind here updates them all. */
export const MATERIALIZED_SOURCE_TYPES = ["web", "youtube", "file"] as const;
export type MaterializedSourceType = (typeof MATERIALIZED_SOURCE_TYPES)[number];

/** A URL or YouTube link to fetch via brevilabs primitives. */
export interface RemoteSource {
  type: UrlKind;
  /** The configured URL — also the cache key and fingerprint basis. */
  url: string;
}

/** An in-vault binary file (PDF/image/doc) to parse into searchable text. */
export interface FileSource {
  /** Vault-relative path (the user-facing source identity). */
  vaultPath: string;
  /** Lowercased extension passed to the parser. */
  ext: string;
  /** Cheap change signal — no read required to compute. */
  mtime: number;
  size: number;
  /** Lazily reads the file's bytes (only invoked when a (re)parse is needed). */
  read: () => Promise<ArrayBuffer>;
}

/** Brevilabs-backed converters, injected so the core stays network-free in tests. */
export interface ContextConverters {
  fetchRemote: (source: RemoteSource) => Promise<string>;
  parseFile: (bytes: ArrayBuffer, ext: string) => Promise<string>;
}

/** One successfully-present cache file (fresh or kept-stale), for the manifest. */
export interface MaterializedEntry {
  type: MaterializedSourceType;
  /** Original source (URL or vault path). */
  source: string;
  /** Snapshot file basename within its source-kind bucket (`<type>-<md5>.md`). */
  cacheFileName: string;
  /**
   * Absolute, OS-native path of the snapshot file, for the manifest's snapshot
   * pointer (the agent reads it directly). Filled by the DESKTOP materializer
   * from {@link import("./conversionsLocation")}; this node-free store never sets
   * it, so every reader must tolerate its absence (degrade to no pointer).
   */
  snapshotAbsPath?: string;
}

/**
 * A source that failed to fetch/parse during materialization. The run still
 * completes (the session degrades gracefully); these are surfaced to the status
 * icon + popover so the failure is diagnosable. `usedStaleSnapshot` distinguishes
 * "refresh failed but a previous snapshot is still in use" (context available,
 * just stale) from "no snapshot at all, source is missing".
 */
export interface SourceFailure {
  source: string;
  kind: MaterializedSourceType;
  error: string;
  usedStaleSnapshot: boolean;
}

/** Identity of one source as it moves through the materialization lifecycle. */
export interface MaterializeSourceIdentity {
  kind: MaterializedSourceType;
  source: string;
}

/**
 * Progress for the materialization loops, emitted as work lands. The step counts
 * (`prefetch`/`parse`, `done`/`total`) drive the loading card's progress rows;
 * the per-source lifecycle events drive the popover's live queue — `itemStart`
 * when a source actually begins fetching/parsing (a cheap-skip never starts),
 * then `itemFailed`/`itemSettled` when it lands. All are carried OUT-OF-BAND from
 * the materialization RESULT.
 */
export type MaterializeProgress =
  | { phase: "prefetch" | "parse"; done: number; total: number }
  | { phase: "itemStart"; item: MaterializeSourceIdentity }
  | { phase: "itemFailed"; item: MaterializeSourceIdentity; failure: SourceFailure }
  | { phase: "itemSettled"; item: MaterializeSourceIdentity };

export interface MaterializeSourcesInput {
  /**
   * Directory for shared remote snapshots (web pages, YouTube transcripts).
   * Vault-wide — keyed by source identity, never by project — so the SAME source
   * referenced by N projects resolves to ONE snapshot here.
   */
  remotesDir: string;
  /** Directory for shared in-vault file snapshots (PDFs/images), keyed by vault path. */
  filesDir: string;
  /**
   * Directory for THIS project's failure markers. Bucketed per project (snapshots
   * are shared, but a failure is meaningful only to the project that hit it), so
   * it is the one directory safe to reconcile against a single project's sources.
   */
  markerDir: string;
  fs: ContextCacheFs;
  converters: ContextConverters;
  remotes: RemoteSource[];
  files: FileSource[];
  /** Current wall-clock (ms) — injected for deterministic snapshot timestamps. */
  nowMs: number;
  /**
   * Re-attempt every failed source even if a persisted failure marker would
   * otherwise cheap-skip it. Default `false` (the automatic path skips known-bad
   * sources); set `true` only by the user-driven "Retry" actions so a manual
   * retry always forces a fresh fetch/parse.
   */
  forceRetryFailed?: boolean;
  /** Optional progress sink, fired per item as each loop advances. */
  onProgress?: (progress: MaterializeProgress) => void;
  /**
   * Optional critical section wrapping each source's ENTIRE read-decide-write,
   * keyed by its snapshot file name. The materializer injects a global
   * per-artifact lock so two projects cold-converting the same shared source
   * converge to one fetch: the first writes the snapshot, the second re-reads the
   * meta inside the lock and cheap-skips. Defaults to a pass-through — the store
   * stays pure and single-project unit tests need no lock. Keyed by file name
   * (identity-derived, so the same source across projects shares one lock).
   */
  withSourceLock?: <T>(key: string, run: () => Promise<T>) => Promise<T>;
}

export interface MaterializeSourcesResult {
  entries: MaterializedEntry[];
  /**
   * Failure-marker names this project still references (a fresh or honored
   * marker). Only the per-project marker directory is reconciled against these;
   * shared snapshots are never reconciled (cross-project deletion).
   */
  wantedMarkerNames: Set<string>;
  /** Sources that failed to fetch/parse this run (empty when all succeeded). */
  failures: SourceFailure[];
}

/** Metadata block persisted at the top of every cache file. */
export interface CacheEntryMeta {
  /** Cache format version — readers discard a mismatch as a miss (see {@link CACHE_SCHEMA_VERSION}). */
  schemaVersion: number;
  sourceType: MaterializedSourceType;
  /** Origin URL for web/youtube snapshots. */
  sourceUrl?: string;
  /** Vault path for in-vault file snapshots. */
  sourcePath?: string;
  fetchedAt: string;
  /** Cheap-skip key: identity for remotes, `mtime:size` for files. */
  fingerprint: string;
}

const META_OPEN = "<!-- copilot-context-cache";
const META_CLOSE = "-->";
/**
 * Persisted cache-format version. Bump ONLY when an EXISTING field's semantics
 * change (e.g. the `fingerprint` `mtime:size` format) — readers then treat a
 * mismatch as a cache miss and re-materialize, instead of misreading an old file
 * as fresh. Additive/removed fields are tolerant-parsed and need no bump. The
 * cache is regenerable, so this discards-and-rebuilds rather than migrating
 * (unlike `settingsVersion`, which migrates non-regenerable settings).
 *
 * Exported so tests can stamp a current-version fixture without hardcoding the
 * number (which would silently break them on the next bump).
 */
export const CACHE_SCHEMA_VERSION = 1;

/**
 * Persisted failure marker: a source that failed to fetch/parse with NO usable
 * snapshot. Negative cache — a later automatic run cheap-skips a known-bad
 * source (reading the stored error) instead of re-hitting brevilabs on every new
 * session, until the user forces a retry. A `.json` file — never `.md` — so the
 * agent never greps a failure marker as if it were materialized context. Cleared
 * when the source later succeeds.
 */
export interface FailureMarker {
  /** Cache format version — readers discard a mismatch as a miss (see {@link CACHE_SCHEMA_VERSION}). */
  schemaVersion: number;
  source: string;
  kind: MaterializedSourceType;
  error: string;
  failedAt: number;
  /**
   * The file's `mtime:size` fingerprint at failure time (file kind only). The
   * cheap-skip is honored only while this still matches the live file, so
   * editing/replacing a failed file re-attempts it immediately — mirroring the
   * snapshot path's fingerprint check. Absent for remotes (identity-keyed); a
   * marker written before this field existed is treated as untrustworthy and
   * re-attempted once rather than skipped on stale information.
   */
  fingerprint?: string;
}

/**
 * Materialize every configured source: remote snapshots into `remotesDir`, file
 * snapshots into `filesDir`, failure markers into the per-project `markerDir`,
 * skipping any whose fingerprint is unchanged (a successful snapshot is kept
 * indefinitely). A fetch/parse failure never throws: an existing stale file is
 * kept, otherwise the source is skipped and a failure marker is written. A later
 * automatic run cheap-skips that known-bad source (re-surfacing the stored error)
 * until the file changes or `forceRetryFailed` forces a fresh attempt. Returns
 * the present entries, the live failure-marker names (so the per-project marker
 * reconcile keeps them), and the per-source failures for this run.
 */
export async function materializeSources(
  input: MaterializeSourcesInput
): Promise<MaterializeSourcesResult> {
  const { remotesDir, filesDir, markerDir, fs, converters, nowMs, onProgress } = input;
  const forceRetryFailed = input.forceRetryFailed ?? false;
  // Default to a pass-through so the store stays lock-agnostic; the materializer
  // injects the real global per-artifact lock.
  const withSourceLock =
    input.withSourceLock ?? (<T>(_key: string, run: () => Promise<T>) => run());
  // Ensure every target dir exists before any write. A mkdir failure is NOT
  // swallowed here: it throws so the materializer's whole-run catch degrades the
  // session to the empty result (a per-source failure would wrongly imply the
  // rest of the cache is writable).
  await fs.mkdirRecursive(remotesDir);
  await fs.mkdirRecursive(filesDir);
  await fs.mkdirRecursive(markerDir);

  const entries: MaterializedEntry[] = [];
  const failures: SourceFailure[] = [];
  // Only failure markers are reconciled (per-project, safe to prune); shared
  // snapshots are never reconciled, so they are never added to a wanted set.
  const wantedMarkerNames = new Set<string>();

  // Dedupe up front so the emitted totals match the actual work performed.
  const remotes = dedupeBy(input.remotes, (r) => `${r.type}:${r.url}`);
  const files = dedupeBy(input.files, (f) => f.vaultPath);

  // URLs are fetched in PARALLEL (matching the legacy CAG cache — `url4llm`
  // calls are independent and each failure is isolated per source); binary files
  // are parsed SEQUENTIALLY (heavier, also matching CAG). Each source emits
  // `itemStart` only when it truly begins work (a cheap-skip stays silent) and
  // `itemFailed`/`itemSettled` when it lands, so the popover renders a live queue.
  if (remotes.length > 0) onProgress?.({ phase: "prefetch", done: 0, total: remotes.length });
  let prefetchDone = 0;
  const remoteResults = await Promise.all(
    remotes.map(async (remote) => {
      const item: MaterializeSourceIdentity = { kind: remote.type, source: remote.url };
      const fileName = cacheFileName(remote.type, remote.url);
      const markerName = failureMarkerName(remote.type, remote.url);
      // The lock wraps the whole upsert (read meta → decide → fetch → write), so
      // a second project waiting on the same source re-reads the now-present meta
      // inside the lock and cheap-skips instead of re-fetching/overwriting.
      const result = await runWithLifecycle(item, onProgress, (onStart) =>
        withSourceLock(fileName, () =>
          upsertRemote(
            remotesDir,
            markerDir,
            fileName,
            markerName,
            remote,
            converters,
            fs,
            nowMs,
            forceRetryFailed,
            onStart
          )
        )
      );
      prefetchDone += 1;
      onProgress?.({ phase: "prefetch", done: prefetchDone, total: remotes.length });
      return { remote, result };
    })
  );
  // Fold results in the ORIGINAL order — the parallel tasks above must not race
  // on these shared collections, so the mutation happens here, sequentially.
  for (const { remote, result } of remoteResults) {
    const fileName = cacheFileName(remote.type, remote.url);
    const markerName = failureMarkerName(remote.type, remote.url);
    if (result.present) {
      entries.push({ type: remote.type, source: remote.url, cacheFileName: fileName });
    }
    if (result.failure) {
      failures.push(result.failure);
      // The marker belongs to a still-configured source: keep it (reconcile
      // would otherwise delete it the same run we wrote/honored it).
      if (result.markerWanted) wantedMarkerNames.add(markerName);
    }
  }

  if (files.length > 0) onProgress?.({ phase: "parse", done: 0, total: files.length });
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const item: MaterializeSourceIdentity = { kind: "file", source: file.vaultPath };
    const fileName = cacheFileName("file", file.vaultPath);
    const markerName = failureMarkerName("file", file.vaultPath);
    const result = await runWithLifecycle(item, onProgress, (onStart) =>
      withSourceLock(fileName, () =>
        upsertFile(
          filesDir,
          markerDir,
          fileName,
          markerName,
          file,
          converters,
          fs,
          nowMs,
          forceRetryFailed,
          onStart
        )
      )
    );
    if (result.present) {
      entries.push({ type: "file", source: file.vaultPath, cacheFileName: fileName });
    }
    if (result.failure) {
      failures.push(result.failure);
      if (result.markerWanted) wantedMarkerNames.add(markerName);
    }
    onProgress?.({ phase: "parse", done: i + 1, total: files.length });
  }

  return { entries, wantedMarkerNames, failures };
}

/**
 * Run one source's upsert and emit its lifecycle events. `itemStart` fires only
 * if the upsert actually began work (its `onStart` callback ran — a cheap-skip
 * never calls it, so a cached source stays silent and renders straight to Ready).
 * On settle, a failure emits `itemFailed` (carrying the error), success emits
 * `itemSettled`; both remove the source from the popover's "processing" set.
 *
 * This is the lifecycle OWNER: an upsert that throws (e.g. the failure-marker
 * write itself fails on a full/locked disk) is isolated into a per-source
 * failure rather than propagating. Reason: the remote upserts run under one
 * `Promise.all`, so a single rejection would (a) cancel nothing — sibling
 * sources keep running and their late `onProgress` would re-publish a `blocking`
 * state after the run already settled to `done`, stranding the loading card —
 * and (b) collapse the whole run into the materializer's whole-run catch. A
 * conservative per-source failure keeps the run resolvable and matches the
 * legacy CAG tracker's per-source isolation.
 */
async function runWithLifecycle(
  item: MaterializeSourceIdentity,
  onProgress: ((progress: MaterializeProgress) => void) | undefined,
  run: (onStart: () => void) => Promise<UpsertResult>
): Promise<UpsertResult> {
  let started = false;
  let result: UpsertResult;
  try {
    result = await run(() => {
      started = true;
      onProgress?.({ phase: "itemStart", item });
    });
  } catch (err) {
    // The only path that throws past the upsert's own catch today is the
    // failure-marker write, which runs only when there's no usable snapshot — so
    // `usedStaleSnapshot` is false here. A future throw site that DOES hold a
    // usable stale snapshot should convert its error inside the upsert (with
    // `usedStaleSnapshot: true`) rather than fall through to this default.
    result = {
      present: false,
      failure: {
        source: item.source,
        kind: item.kind,
        error: err2String(err),
        usedStaleSnapshot: false,
      },
    };
  }
  // Only emit a settle event when the source was shown as processing (started);
  // a throw before `onStart` leaves nothing to clear — the final `failures`
  // reconciliation carries it instead.
  if (started) {
    if (result.failure) onProgress?.({ phase: "itemFailed", item, failure: result.failure });
    else onProgress?.({ phase: "itemSettled", item });
  }
  return result;
}

/** Outcome of an upsert: whether a usable snapshot is present, and any failure. */
interface UpsertResult {
  present: boolean;
  failure?: SourceFailure;
  /**
   * True when a failure marker for this source was written this run. The caller
   * adds it to `wantedMarkerNames` so the same-run marker reconcile doesn't delete
   * the marker it just wrote (which the status panel reads to surface the error).
   */
  markerWanted?: boolean;
}

async function upsertRemote(
  snapshotDir: string,
  markerDir: string,
  fileName: string,
  markerName: string,
  remote: RemoteSource,
  converters: ContextConverters,
  fs: ContextCacheFs,
  nowMs: number,
  forceRetryFailed: boolean,
  onStart?: () => void
): Promise<UpsertResult> {
  const filePath = joinCachePath(snapshotDir, fileName);
  const markerPath = joinCachePath(markerDir, markerName);
  const existing = await readMeta(fs, filePath);
  const fingerprint = `${remote.type}:${remote.url}`;
  // A successful snapshot is kept indefinitely (identity fingerprint), mirroring
  // the legacy project-context cache: re-fetch only when the source is added or
  // its config changes, never on a timer.
  if (existing !== null && existing.fingerprint === fingerprint) {
    // The shared snapshot is present — possibly written by another project after
    // THIS project recorded a failure. Best-effort clear our own stale marker so
    // the status panel stops surfacing a failure the shared snapshot resolved.
    await removeMarkerBestEffort(fs, markerPath);
    return { present: true };
  }

  // Negative cheap-skip: a prior failure with no usable snapshot. Skip the
  // re-fetch (don't re-pay the latency on every new session) and re-surface the
  // stored error, unless the user forced a retry. The `existing === null` guard
  // keeps the success path above authoritative — a kept-stale snapshot is never
  // treated as a failure to skip. No `onStart` fires, so the source stays out of
  // the live "processing" queue and is carried purely by the failures list.
  if (!forceRetryFailed && existing === null) {
    const marker = await readFailureMarker(fs, markerPath);
    if (marker !== null) {
      return {
        present: false,
        failure: { source: remote.url, kind: remote.type, error: marker.error, usedStaleSnapshot: false }, // prettier-ignore
        markerWanted: true, // honor the existing marker so reconcile keeps it
      };
    }
  }

  try {
    onStart?.(); // about to fetch — surfaces this source as "processing"
    const content = await converters.fetchRemote(remote);
    await writeEntry(fs, filePath, remote.type, remote.url, fingerprint, content, nowMs);
    // Best-effort marker clear: the snapshot is already written, so a delete
    // error must NOT downgrade this success to a failure.
    await removeMarkerBestEffort(fs, markerPath);
    return { present: true };
  } catch (err) {
    const error = err2String(err);
    logWarn(`[project-context] fetch failed for ${remote.url}: ${error}`);
    const usedStaleSnapshot = existing !== null;
    // Only write a failure marker when there is NO snapshot to fall back on;
    // a stale snapshot is still usable, so its source is not "missing". When a
    // stale snapshot IS usable, best-effort clear any pre-existing marker: a
    // "missing source" marker is now semantically wrong, and the single-source
    // retry path skips the marker reconcile that would otherwise drop it.
    let markerWanted = false;
    if (!usedStaleSnapshot) {
      await writeFailureMarker(fs, markerPath, remote.url, remote.type, error, nowMs);
      markerWanted = true;
    } else {
      await removeMarkerBestEffort(fs, markerPath);
    }
    return {
      present: usedStaleSnapshot,
      failure: { source: remote.url, kind: remote.type, error, usedStaleSnapshot },
      markerWanted,
    };
  }
}

async function upsertFile(
  snapshotDir: string,
  markerDir: string,
  fileName: string,
  markerName: string,
  file: FileSource,
  converters: ContextConverters,
  fs: ContextCacheFs,
  nowMs: number,
  forceRetryFailed: boolean,
  onStart?: () => void
): Promise<UpsertResult> {
  const filePath = joinCachePath(snapshotDir, fileName);
  const markerPath = joinCachePath(markerDir, markerName);
  const existing = await readMeta(fs, filePath);
  const fingerprint = `${file.mtime}:${file.size}`;
  // A parsed snapshot is kept while the file is unchanged; a different
  // `mtime:size` re-parses.
  if (existing !== null && existing.fingerprint === fingerprint) {
    // See upsertRemote: clear our own stale marker now that the shared snapshot
    // is present (another project may have produced it).
    await removeMarkerBestEffort(fs, markerPath);
    return { present: true };
  }

  // Negative cheap-skip: a prior parse failure with no snapshot — honored only
  // while the file is byte-for-byte unchanged (marker fingerprint matches the
  // live `mtime:size`), so an edited/replaced file re-attempts immediately. A
  // marker without a fingerprint predates this field: treat it as untrustworthy
  // and re-attempt once rather than skip on stale information.
  if (!forceRetryFailed && existing === null) {
    const marker = await readFailureMarker(fs, markerPath);
    if (marker !== null && marker.fingerprint === fingerprint) {
      return {
        present: false,
        failure: { source: file.vaultPath, kind: "file", error: marker.error, usedStaleSnapshot: false }, // prettier-ignore
        markerWanted: true, // honor the existing marker so reconcile keeps it
      };
    }
  }

  try {
    onStart?.(); // about to parse — surfaces this source as "processing"
    const content = await converters.parseFile(await file.read(), file.ext);
    await writeEntry(fs, filePath, "file", file.vaultPath, fingerprint, content, nowMs);
    // Best-effort (see upsertRemote): a marker-delete error must not fail a
    // snapshot that is already written.
    await removeMarkerBestEffort(fs, markerPath);
    return { present: true };
  } catch (err) {
    const error = err2String(err);
    logWarn(`[project-context] parse failed for ${file.vaultPath}: ${error}`);
    const usedStaleSnapshot = existing !== null;
    // See upsertRemote: write a marker only when no snapshot exists; when a stale
    // snapshot is usable, best-effort clear any pre-existing marker so a single-
    // source retry (which skips the marker reconcile) can't leave a stale failure.
    let markerWanted = false;
    if (!usedStaleSnapshot) {
      await writeFailureMarker(fs, markerPath, file.vaultPath, "file", error, nowMs, fingerprint);
      markerWanted = true;
    } else {
      await removeMarkerBestEffort(fs, markerPath);
    }
    return {
      present: usedStaleSnapshot,
      failure: { source: file.vaultPath, kind: "file", error, usedStaleSnapshot },
      markerWanted,
    };
  }
}

/**
 * Delete this project's failure markers that the current config no longer
 * references. Only the per-project marker directory is reconciled: snapshots are
 * shared vault-wide, so pruning them against a single project's wanted set would
 * delete files other projects still reference (the legacy `clearForProject`
 * cross-project deletion bug). Unrecognized files are always preserved.
 */
export async function reconcileMarkers(
  fs: ContextCacheFs,
  markerDir: string,
  wantedMarkerNames: Set<string>
): Promise<void> {
  const present = await fs.list(markerDir);
  for (const name of present) {
    if (wantedMarkerNames.has(name)) continue;
    if (!OWNED_MARKER_RE.test(name)) continue;
    await fs.remove(joinCachePath(markerDir, name));
  }
}

/**
 * Join a cache-relative file name onto the cache dir. Cache paths are always
 * vault-relative and POSIX-separated, so a plain "/" join (no `node:path`) is
 * correct on every platform and keeps this module Node-builtin-free.
 */
function joinCachePath(dir: string, name: string): string {
  const left = dir.replace(/\/+$/, "");
  const right = name.replace(/^\/+/, "");
  return left ? `${left}/${right}` : right;
}

/**
 * A `failed-<type>-<hash>.json` failure marker this module owns and may prune in
 * {@link reconcileMarkers}. Built from MATERIALIZED_SOURCE_TYPES so a new source
 * kind is covered automatically; the values are plain identifiers, so a bare
 * alternation needs no regex escaping. `md5` emits lowercase hex, so the
 * `[0-9a-f]+` class matches the hash.
 */
const SOURCE_TYPE_ALTERNATION = MATERIALIZED_SOURCE_TYPES.join("|");
const OWNED_MARKER_RE = new RegExp(`^failed-(${SOURCE_TYPE_ALTERNATION})-[0-9a-f]+\\.json$`);

/**
 * Deterministic snapshot file name for a source. Exported (with
 * {@link failureMarkerName}) so read-only consumers — the edit modal's Content
 * Conversion panel — can probe a cache dir for a source's persisted state by
 * name alone, without parsing file contents.
 */
export function cacheFileName(type: MaterializedSourceType, source: string): string {
  return `${type}-${md5(source)}.md`;
}

/** Failure marker name for a source (parallel to {@link cacheFileName}). */
export function failureMarkerName(type: MaterializedSourceType, source: string): string {
  return `failed-${type}-${md5(source)}.json`;
}

/**
 * Remove a failure marker without ever failing the caller. The marker is a pure
 * status hint, so a delete error (e.g. a transient EACCES) must not turn a
 * present, usable snapshot into a reported failure — unlike a snapshot WRITE,
 * which must surface (see {@link createNodeContextCacheFs}). Missing markers are
 * already a no-op via the fs contract; this only guards a hard delete error.
 */
async function removeMarkerBestEffort(fs: ContextCacheFs, markerPath: string): Promise<void> {
  try {
    await fs.remove(markerPath);
  } catch (err) {
    logWarn(`[project-context] could not clear stale failure marker ${markerPath}: ${err2String(err)}`); // prettier-ignore
  }
}

async function writeFailureMarker(
  fs: ContextCacheFs,
  markerPath: string,
  source: string,
  kind: MaterializedSourceType,
  error: string,
  nowMs: number,
  fingerprint?: string
): Promise<void> {
  const marker: FailureMarker = { schemaVersion: CACHE_SCHEMA_VERSION, source, kind, error, failedAt: nowMs, ...(fingerprint !== undefined ? { fingerprint } : {}) }; // prettier-ignore
  await fs.writeText(markerPath, JSON.stringify(marker));
}

/** Read and tolerantly parse a source's failure marker (null when absent/malformed). */
async function readFailureMarker(
  fs: ContextCacheFs,
  markerPath: string
): Promise<FailureMarker | null> {
  let raw: string;
  try {
    raw = await fs.readText(markerPath);
  } catch {
    return null;
  }
  return parseFailureMarker(raw);
}

/**
 * Tolerant parse of a failure marker's JSON content (null on any malformation).
 * Exported for read-only consumers that fetch the bytes themselves rather than
 * through a {@link ContextCacheFs}.
 *
 * DESIGN NOTE: `kind` is type-checked as a string but NOT validated against the
 * `FailureMarker["kind"]` union. These markers are written only by this module
 * (never user-authored), so a value outside the union can't arise on the real
 * path; the downstream panel renders an unknown kind harmlessly as a generic
 * failure. Tightening to a union whitelist would only guard a hand-corrupted
 * cache file, which has no real caller.
 */
export function parseFailureMarker(raw: string): FailureMarker | null {
  try {
    const parsed = JSON.parse(raw) as Partial<FailureMarker>;
    // Version mismatch -> treat as no marker, so the source is re-attempted.
    if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
    if (
      typeof parsed.source !== "string" ||
      typeof parsed.kind !== "string" ||
      typeof parsed.error !== "string" ||
      typeof parsed.failedAt !== "number"
    ) {
      return null;
    }
    return parsed as FailureMarker;
  } catch {
    return null;
  }
}

async function writeEntry(
  fs: ContextCacheFs,
  filePath: string,
  sourceType: MaterializedSourceType,
  source: string,
  fingerprint: string,
  content: string,
  nowMs: number
): Promise<void> {
  const fetchedAt = new Date(nowMs).toISOString();
  const meta: CacheEntryMeta = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    sourceType,
    ...(sourceType === "file" ? { sourcePath: source } : { sourceUrl: source }),
    fetchedAt,
    fingerprint,
  };
  const body = content.trim();
  const text =
    `${META_OPEN}\n${JSON.stringify(meta)}\n${META_CLOSE}\n\n` +
    `# ${sourceType === "file" ? "File" : sourceType === "youtube" ? "YouTube" : "URL"}: ${source}\n` +
    `_Materialized ${fetchedAt} — snapshot; refresh if the source changed._\n\n` +
    `${body}\n`;
  await fs.writeText(filePath, text);
}

async function readMeta(fs: ContextCacheFs, filePath: string): Promise<CacheEntryMeta | null> {
  let raw: string;
  try {
    raw = await fs.readText(filePath);
  } catch {
    return null;
  }
  return parseSnapshotMeta(raw);
}

/**
 * Tolerant parse of a snapshot file's leading meta block (null on any
 * malformation). Exported for read-only consumers that fetch the bytes
 * themselves — the edit modal compares a file snapshot's stored `fingerprint`
 * against the live `mtime:size` to detect a stale conversion.
 */
export function parseSnapshotMeta(raw: string): CacheEntryMeta | null {
  if (!raw.startsWith(META_OPEN)) return null;
  // Match the close marker only at a line start (the writer always emits it as
  // `\n${META_CLOSE}\n`). A bare `indexOf(META_CLOSE)` would match a `-->`
  // embedded in the JSON's sourcePath/sourceUrl, truncating the JSON and forcing
  // a permanent cache miss for any source whose path legitimately contains `-->`.
  const close = raw.indexOf(`\n${META_CLOSE}`, META_OPEN.length);
  if (close < 0) return null;
  const json = raw.slice(META_OPEN.length, close).trim();
  try {
    const parsed = JSON.parse(json) as Partial<CacheEntryMeta>;
    // Version mismatch -> treat as a miss so the source re-materializes. Note the
    // old snapshot is then NOT used as a stale fallback if the re-fetch fails; on
    // an unreleased format that one-time rebuild is acceptable.
    if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
    const hasSource = Boolean(parsed.sourceUrl ?? parsed.sourcePath);
    if (!parsed.sourceType || !hasSource || !parsed.fetchedAt || !parsed.fingerprint) {
      return null;
    }
    return parsed as CacheEntryMeta;
  } catch {
    return null;
  }
}

function dedupeBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

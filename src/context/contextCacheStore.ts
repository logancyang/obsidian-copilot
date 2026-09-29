import { err2String } from "@/errorFormat";
import { logWarn } from "@/logger";
import { md5 } from "@/utils/hash";
import type { UrlKind } from "@/utils/urlTagUtils";
import type { ContextCacheFs } from "./contextCacheFs";

export const MATERIALIZED_SOURCE_TYPES = ["web", "youtube", "file"] as const;
export type MaterializedSourceType = (typeof MATERIALIZED_SOURCE_TYPES)[number];

export interface RemoteSource {
  type: UrlKind;
  url: string;
}

export interface FileSource {
  vaultPath: string;
  ext: string;
  mtime: number;
  size: number;
  read: () => Promise<ArrayBuffer>;
}

export interface ContextConverters {
  fetchRemote: (source: RemoteSource) => Promise<string>;
  parseFile: (bytes: ArrayBuffer, ext: string) => Promise<string>;
}

export interface MaterializedEntry {
  type: MaterializedSourceType;
  source: string;
  cacheFileName: string;
  snapshotAbsPath?: string;
}

export interface SourceFailure {
  source: string;
  kind: MaterializedSourceType;
  error: string;
  usedStaleSnapshot: boolean;
}

export interface MaterializeSourceIdentity {
  kind: MaterializedSourceType;
  source: string;
}

export type MaterializeProgress =
  | { phase: "prefetch" | "parse"; done: number; total: number }
  | { phase: "itemStart"; item: MaterializeSourceIdentity }
  | { phase: "itemFailed"; item: MaterializeSourceIdentity; failure: SourceFailure }
  | { phase: "itemSettled"; item: MaterializeSourceIdentity };

export interface MaterializeSourcesInput {
  remotesDir: string;
  filesDir: string;
  markerDir: string;
  fs: ContextCacheFs;
  converters: ContextConverters;
  remotes: RemoteSource[];
  files: FileSource[];
  nowMs: number;
  forceRetryFailed?: boolean;
  onProgress?: (progress: MaterializeProgress) => void;
  withSourceLock?: <T>(key: string, run: () => Promise<T>) => Promise<T>;
}

export interface MaterializeSourcesResult {
  entries: MaterializedEntry[];
  wantedMarkerNames: Set<string>;
  failures: SourceFailure[];
}

export interface CacheEntryMeta {
  schemaVersion: number;
  sourceType: MaterializedSourceType;
  sourceUrl?: string;
  sourcePath?: string;
  fetchedAt: string;
  fingerprint: string;
}

const META_OPEN = "<!-- copilot-context-cache";
const META_CLOSE = "-->";
export const CACHE_SCHEMA_VERSION = 1;

export interface FailureMarker {
  schemaVersion: number;
  source: string;
  kind: MaterializedSourceType;
  error: string;
  failedAt: number;
  fingerprint?: string;
}

export async function materializeSources(
  input: MaterializeSourcesInput
): Promise<MaterializeSourcesResult> {
  const { remotesDir, filesDir, markerDir, fs, converters, nowMs, onProgress } = input;
  const forceRetryFailed = input.forceRetryFailed ?? false;
  const withSourceLock =
    input.withSourceLock ?? (<T>(_key: string, run: () => Promise<T>) => run());
  await fs.mkdirRecursive(remotesDir);
  await fs.mkdirRecursive(filesDir);
  await fs.mkdirRecursive(markerDir);

  const entries: MaterializedEntry[] = [];
  const failures: SourceFailure[] = [];
  const wantedMarkerNames = new Set<string>();

  const remotes = dedupeBy(input.remotes, (r) => `${r.type}:${r.url}`);
  const files = dedupeBy(input.files, (f) => f.vaultPath);

  if (remotes.length > 0) onProgress?.({ phase: "prefetch", done: 0, total: remotes.length });
  let prefetchDone = 0;
  const remoteResults = await Promise.all(
    remotes.map(async (remote) => {
      const item: MaterializeSourceIdentity = { kind: remote.type, source: remote.url };
      const fileName = cacheFileName(remote.type, remote.url);
      const markerName = failureMarkerName(remote.type, remote.url);
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
  for (const { remote, result } of remoteResults) {
    const fileName = cacheFileName(remote.type, remote.url);
    const markerName = failureMarkerName(remote.type, remote.url);
    if (result.present) {
      entries.push({ type: remote.type, source: remote.url, cacheFileName: fileName });
    }
    if (result.failure) {
      failures.push(result.failure);
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
  if (started) {
    if (result.failure) onProgress?.({ phase: "itemFailed", item, failure: result.failure });
    else onProgress?.({ phase: "itemSettled", item });
  }
  return result;
}

interface UpsertResult {
  present: boolean;
  failure?: SourceFailure;
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
  if (existing !== null && existing.fingerprint === fingerprint) {
    await removeMarkerBestEffort(fs, markerPath);
    return { present: true };
  }

  if (!forceRetryFailed && existing === null) {
    const marker = await readFailureMarker(fs, markerPath);
    if (marker !== null) {
      return {
        present: false,
        failure: { source: remote.url, kind: remote.type, error: marker.error, usedStaleSnapshot: false }, // prettier-ignore
        markerWanted: true,
      };
    }
  }

  try {
    onStart?.();
    const content = await converters.fetchRemote(remote);
    await writeEntry(fs, filePath, remote.type, remote.url, fingerprint, content, nowMs);
    await removeMarkerBestEffort(fs, markerPath);
    return { present: true };
  } catch (err) {
    const error = err2String(err);
    logWarn(`[project-context] fetch failed for ${remote.url}: ${error}`);
    const usedStaleSnapshot = existing !== null;
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
  if (existing !== null && existing.fingerprint === fingerprint) {
    await removeMarkerBestEffort(fs, markerPath);
    return { present: true };
  }

  if (!forceRetryFailed && existing === null) {
    const marker = await readFailureMarker(fs, markerPath);
    if (marker !== null && marker.fingerprint === fingerprint) {
      return {
        present: false,
        failure: { source: file.vaultPath, kind: "file", error: marker.error, usedStaleSnapshot: false }, // prettier-ignore
        markerWanted: true,
      };
    }
  }

  try {
    onStart?.();
    const content = await converters.parseFile(await file.read(), file.ext);
    await writeEntry(fs, filePath, "file", file.vaultPath, fingerprint, content, nowMs);
    await removeMarkerBestEffort(fs, markerPath);
    return { present: true };
  } catch (err) {
    const error = err2String(err);
    logWarn(`[project-context] parse failed for ${file.vaultPath}: ${error}`);
    const usedStaleSnapshot = existing !== null;
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

function joinCachePath(dir: string, name: string): string {
  const left = dir.replace(/\/+$/, "");
  const right = name.replace(/^\/+/, "");
  return left ? `${left}/${right}` : right;
}

const SOURCE_TYPE_ALTERNATION = MATERIALIZED_SOURCE_TYPES.join("|");
const OWNED_MARKER_RE = new RegExp(`^failed-(${SOURCE_TYPE_ALTERNATION})-[0-9a-f]+\\.json$`);

export function cacheFileName(type: MaterializedSourceType, source: string): string {
  return `${type}-${md5(source)}.md`;
}

export function failureMarkerName(type: MaterializedSourceType, source: string): string {
  return `failed-${type}-${md5(source)}.json`;
}

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

export function parseFailureMarker(raw: string): FailureMarker | null {
  try {
    const parsed = JSON.parse(raw) as Partial<FailureMarker>;
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

export function parseSnapshotMeta(raw: string): CacheEntryMeta | null {
  if (!raw.startsWith(META_OPEN)) return null;
  const close = raw.indexOf(`\n${META_CLOSE}`, META_OPEN.length);
  if (close < 0) return null;
  const json = raw.slice(META_OPEN.length, close).trim();
  try {
    const parsed = JSON.parse(json) as Partial<CacheEntryMeta>;
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
